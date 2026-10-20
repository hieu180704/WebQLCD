// Repository hợp đồng trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
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
import type { Actor, ContractDraft } from "../application/ports";
import { planDisbursement, type ContractTerms } from "../domain/contract";
import { DrizzleContractRepository } from "./drizzle-contract-repository";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-20";
const cipher = new CccdCipher(randomBytes(32), randomBytes(32));

describe.skipIf(!url)("DrizzleContractRepository", () => {
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
    const id = `ct_${Date.now()}_${n++}`;
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
    const operationId = crypto.randomUUID();
    for (const e of entries) {
      const amount = e.type === "disbursement" ? e.amount.negate().toBigInt() : e.amount.toBigInt();
      const contractId = "contractId" in e ? e.contractId : null;
      const [from, to] = e.type === "interest_payment" ? [e.periodFrom, e.periodTo] : [null, null];
      await tx.execute(
        sql`INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, period_from, period_to, created_by)
            VALUES (${op.shopId}, ${operationId}, ${op.businessDate}, ${amount}, ${e.type}, ${contractId}, ${from}, ${to}, ${op.createdBy})`,
      );
    }
  };
  const repo = (db: Db) => new DrizzleContractRepository(db, new DrizzleCustomerWriter(() => cipher), appendCash);

  const draft = (terms: Partial<ContractTerms> = {}, customer: Partial<NewCustomer> = {}): ContractDraft => {
    const fullTerms: ContractTerms = {
      kind: "secured",
      assetName: "Honda Vision",
      principal: Money.fromNumber(5_000_000),
      interestType: "per_million_per_day",
      interestRate: 30_000n,
      interestPeriodDays: 10,
      termDays: 30,
      loanDate: TODAY,
      prepaidInterest: false,
      ...terms,
    };
    const plan = planDisbursement(fullTerms, TODAY);
    if (!plan.ok) throw new Error(plan.error);
    return {
      terms: fullTerms,
      customer: { fullName: "Nguyễn Văn A", cccd: null, phone: "0912345678", address: null, ...customer },
      note: null,
      disbursement: plan.value,
      businessDate: TODAY,
    };
  };

  it("thu lãi trước: hợp đồng, 2 dòng sổ két chung operation_id, audit; khớp truy vấn đối soát", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const created = await repo(db).create(actor, draft({ prepaidInterest: true }));
      expect(created).toMatchObject({ code: "CD-1", customer: { reused: false, fullName: "Nguyễn Văn A" } });

      const [contract] = await rows<Record<string, unknown>>(
        db,
        sql`SELECT id, principal::text, outstanding_principal::text, interest_paid_until::text, staff_id, interest_rate::text
            FROM contracts WHERE shop_id = ${actor.shopId}`,
      );
      expect(contract).toMatchObject({
        principal: "5000000",
        outstanding_principal: "5000000",
        interest_paid_until: "2026-10-30",
        staff_id: actor.userId,
        interest_rate: "3.0000",
      });

      const cash = await rows<{ type: string; amount: string; operation_id: string; business_date: string; period_to: string | null }>(
        db,
        sql`SELECT type, amount::text, operation_id, business_date::text, period_to::text FROM cash_transactions
            WHERE shop_id = ${actor.shopId} ORDER BY type`,
      );
      expect(cash.map(({ type, amount, business_date }) => ({ type, amount, business_date }))).toEqual([
        { type: "disbursement", amount: "-5000000", business_date: TODAY },
        { type: "interest_payment", amount: "150000", business_date: TODAY },
      ]);
      expect(cash[0].operation_id).toBe(cash[1].operation_id);

      // data-model mục 4: so cột tính sẵn với sổ két.
      const [reconcile] = await rows<{ outstanding: string; paid_until: string; closing: string }>(
        db,
        sql`SELECT
              (c.principal + coalesce(-sum(t.amount) FILTER (WHERE t.type = 'additional_loan'), 0)
                - coalesce(sum(t.amount) FILTER (WHERE t.type = 'principal_repayment'), 0))::text AS outstanding,
              coalesce(max(t.period_to) FILTER (WHERE t.type = 'interest_payment'), c.loan_date)::text AS paid_until,
              (SELECT sum(amount) FROM cash_transactions WHERE shop_id = c.shop_id AND business_date <= ${TODAY})::text AS closing
            FROM contracts c LEFT JOIN cash_transactions t ON t.shop_id = c.shop_id AND t.contract_id = c.id
            WHERE c.shop_id = ${actor.shopId} GROUP BY c.id`,
      );
      expect(reconcile).toEqual({ outstanding: "5000000", paid_until: "2026-10-30", closing: "-4850000" });

      const audits = await rows<{ entity: string }>(db, sql`SELECT entity FROM audit_logs WHERE shop_id = ${actor.shopId} ORDER BY entity`);
      expect(audits.map((a) => a.entity)).toEqual(["contract", "customer"]);
    }));

  it("mã hợp đồng tăng riêng theo tiền tố và theo cửa hàng", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      const codes = [];
      codes.push((await repo(db).create(a, draft())).code);
      codes.push((await repo(db).create(a, draft({ kind: "unsecured", assetName: null }))).code);
      codes.push((await repo(db).create(a, draft())).code);
      codes.push((await repo(db).create(b, draft())).code);
      expect(codes).toEqual(["CD-1", "TC-1", "CD-2", "CD-1"]);
    }));

  it("CCCD trùng trong cửa hàng: dùng lại khách cũ, không ghi đè; CCCD lưu dạng mã hoá + che", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const cccd = "001099012345";
      const first = await repo(db).create(actor, draft({}, { cccd, fullName: "Trần Thị B" }));
      const second = await repo(db).create(actor, draft({}, { cccd, fullName: "Tên Gõ Khác", phone: "0999999999" }));
      expect(second.customer).toEqual({ id: first.customer.id, fullName: "Trần Thị B", reused: true });

      const [customer] = await rows<{ full_name: string; phone: string; cccd_encrypted: string; cccd_masked: string; n: number }>(
        db,
        sql`SELECT full_name, phone, cccd_encrypted, cccd_masked, count(*) OVER ()::int AS n FROM customers WHERE shop_id = ${actor.shopId}`,
      );
      expect(customer).toMatchObject({ full_name: "Trần Thị B", phone: "0912345678", cccd_masked: "********2345", n: 1 });
      expect(customer.cccd_encrypted).not.toContain(cccd);
      expect(cipher.decrypt(actor.shopId, customer.cccd_encrypted)).toBe(cccd);
    }));

  it("không có CCCD: mỗi hợp đồng một khách mới", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const a = await repo(db).create(actor, draft());
      const b = await repo(db).create(actor, draft());
      expect(a.customer.id).not.toBe(b.customer.id);
    }));

  it("cách ly cửa hàng: B không thấy hợp đồng của A; cùng CCCD ở B là khách khác", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      const cccd = "001099012345";
      const inA = await repo(db).create(a, draft({}, { cccd }));
      const inB = await repo(db).create(b, draft({}, { cccd }));
      expect(inB.customer.reused).toBe(false);
      expect(inB.customer.id).not.toBe(inA.customer.id);
      const listB = await repo(db).list(b.shopId, null, 50);
      expect(listB.map((c) => c.code)).toEqual(["CD-1"]);
      expect(listB[0].customerName).toBe("Nguyễn Văn A");
    }));

  it("lỗi giữa chừng thì không để lại khách, mã, sổ két (một transaction)", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      // KTV thuộc cửa hàng khác: khoá ngoại kép (shop_id, staff_id) chặn khi chèn hợp đồng.
      await expect(repo(db).create({ shopId: a.shopId, userId: b.userId }, draft())).rejects.toMatchObject({ code: "23503" });
      const [counts] = await rows<{ customers: number; counters: number; cash: number }>(
        db,
        sql`SELECT (SELECT count(*)::int FROM customers WHERE shop_id = ${a.shopId}) AS customers,
                   (SELECT count(*)::int FROM shop_counters WHERE shop_id = ${a.shopId}) AS counters,
                   (SELECT count(*)::int FROM cash_transactions WHERE shop_id = ${a.shopId}) AS cash`,
      );
      expect(counts).toEqual({ customers: 0, counters: 0, cash: 0 });
    }));

  it("danh sách: mới nhất trước, phân trang keyset, SĐT đã che, lãi suất đọc đúng", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      for (let i = 0; i < 3; i++) await repo(db).create(actor, draft({ interestType: "percent_per_month", interestRate: 15_000n }));
      const page1 = await repo(db).list(actor.shopId, null, 2);
      expect(page1.map((c) => c.code)).toEqual(["CD-3", "CD-2"]);
      expect(page1[0]).toMatchObject({ customerPhone: "091****678", interestRate: 15_000n, interestType: "percent_per_month" });
      expect(page1[0].principal.toBigInt()).toBe(5_000_000n);
      const page2 = await repo(db).list(actor.shopId, page1[1].id, 2);
      expect(page2.map((c) => c.code)).toEqual(["CD-1"]);
    }));
});
