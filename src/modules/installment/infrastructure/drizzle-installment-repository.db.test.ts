// Repository hợp đồng trả góp trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của repository thành savepoint bên trong.
import { randomBytes } from "node:crypto";
import { TransactionRollbackError, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppendCashEntries } from "@/modules/cashbook";
import { CccdCipher, DrizzleCustomerWriter, type NewCustomer } from "@/modules/customer";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import { Money } from "@/shared/kernel/money";
import type { Actor, InstallmentDraft } from "../application/ports";
import type { InstallmentTerms } from "../domain/installment";
import { DrizzleInstallmentRepository } from "./drizzle-installment-repository";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-20";
const cipher = new CccdCipher(randomBytes(32), randomBytes(32));

describe.skipIf(!url)("DrizzleInstallmentRepository", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inTx(fn: (db: Db) => Promise<void>) {
    const db = drizzle({ client: pool, schema });
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as Db);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  }

  const rows = async <T>(db: Db, query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];

  let n = 0;
  async function seedShop(db: Db): Promise<Actor> {
    const id = `tg_${Date.now()}_${n++}`;
    const [shop] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO shops (name, opened_at, trial_ends_at) VALUES ('Tiệm Test', ${TODAY}, now() + interval '7 days') RETURNING id`,
    );
    const [user] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO users (shop_id, name, email, username, role) VALUES (${shop.id}, 'Chủ Test', ${`${id}@test.local`}, ${id}, 'owner') RETURNING id`,
    );
    return { shopId: shop.id, userId: user.id };
  }

  // Ghi sổ két thật bằng SQL như cashbook (test không import nội bộ module khác); dấu tiền theo data-model mục 3.6.
  const appendCash: AppendCashEntries = async (tx, op, entries) => {
    const operationId = op.operationId ?? crypto.randomUUID();
    for (const e of entries) {
      // Bút toán đảo mang số tiền có dấu của dòng gốc, ghi số đối.
      const outflow = e.type === "installment_disbursement" || e.type === "reversal";
      const amount = outflow ? e.amount.negate().toBigInt() : e.amount.toBigInt();
      const installmentId = "installmentContractId" in e ? (e.installmentContractId ?? null) : null;
      const reversesId = e.type === "reversal" ? e.reversesId : null;
      await tx.execute(
        sql`INSERT INTO cash_transactions
              (shop_id, operation_id, business_date, amount, type, installment_contract_id, reverses_id, note, created_by)
            VALUES (${op.shopId}, ${operationId}, ${op.businessDate}, ${amount}, ${e.type}, ${installmentId}, ${reversesId},
                    ${op.note ?? null}, ${op.createdBy})`,
      );
    }
  };
  const repo = (db: Db) => new DrizzleInstallmentRepository(db, new DrizzleCustomerWriter(() => cipher), appendCash);

  const terms = (overrides: Partial<InstallmentTerms> = {}): InstallmentTerms => ({
    amountGiven: Money.fromNumber(4_000_000),
    totalDue: Money.fromNumber(5_000_000),
    totalDays: 50,
    periodDays: 2,
    startDate: TODAY,
    ...overrides,
  });
  const draft = (overrides: Partial<InstallmentTerms> = {}, customer: Partial<NewCustomer> = {}): InstallmentDraft => ({
    terms: terms(overrides),
    customer: { fullName: "Đỗ Minh Tâm", cccd: null, phone: "0938214552", address: null, ...customer },
    note: null,
    businessDate: TODAY,
  });

  it("tạo hợp đồng: mã TG-n, dòng giải ngân chung operation_id với thao tác, audit", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const created = await repo(db).create(actor, draft());
      expect(created).toMatchObject({ code: "TG-1", customer: { reused: false, fullName: "Đỗ Minh Tâm" } });
      expect((await repo(db).create(actor, draft())).code).toBe("TG-2");

      const [contract] = await rows<Record<string, unknown>>(
        db,
        sql`SELECT id, amount_given::text, total_due::text, amount_paid::text, status, staff_id
            FROM installment_contracts WHERE shop_id = ${actor.shopId} AND code = 'TG-1'`,
      );
      expect(contract).toMatchObject({
        amount_given: "4000000",
        total_due: "5000000",
        amount_paid: "0",
        status: "active",
        staff_id: actor.userId,
      });

      const cash = await rows<{ type: string; amount: string; operation_id: string }>(
        db,
        sql`SELECT type, amount::text, operation_id FROM cash_transactions WHERE installment_contract_id = ${contract.id}`,
      );
      expect(cash).toEqual([expect.objectContaining({ type: "installment_disbursement", amount: "-4000000" })]);
      const ops = await rows<{ id: string; kind: string }>(
        db,
        sql`SELECT id, kind FROM installment_operations WHERE installment_contract_id = ${contract.id}`,
      );
      expect(ops).toEqual([{ id: cash[0].operation_id, kind: "disbursement" }]);
      const audit = await rows<{ action: string }>(
        db,
        sql`SELECT action FROM audit_logs WHERE entity = 'installment_contract' AND entity_id = ${contract.id}`,
      );
      expect(audit).toEqual([{ action: "create" }]);
    }));

  it("CCCD trùng trong cửa hàng: dùng lại khách cũ, thông tin khách cũ giữ nguyên", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft({}, { cccd: "001099012345" }));
      const second = await repo(db).create(actor, draft({}, { cccd: "001099012345", fullName: "Tên Khác" }));
      expect(second.customer).toMatchObject({ reused: true, fullName: "Đỗ Minh Tâm" });
    }));

  it("danh sách: mới nhất trước, che SĐT, phân trang keyset; cửa hàng khác không thấy", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const other = await seedShop(db);
      for (let i = 0; i < 3; i++) await repo(db).create(actor, draft());
      await repo(db).create(other, draft());

      const page1 = await repo(db).list(actor.shopId, null, 2);
      expect(page1.map((r) => r.code)).toEqual(["TG-3", "TG-2"]);
      expect(page1[0]).toMatchObject({ customerPhone: "093****552", status: "active", deleted: false, periodDays: 2 });
      expect(page1[0].amountGiven.toBigInt()).toBe(4_000_000n);
      const page2 = await repo(db).list(actor.shopId, page1[1].id, 2);
      expect(page2.map((r) => r.code)).toEqual(["TG-1"]);
      expect((await repo(db).list(other.shopId, null, 10)).map((r) => r.code)).toEqual(["TG-1"]);
    }));
});
