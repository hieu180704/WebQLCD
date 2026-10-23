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
import type { Actor, InstallmentDraft, InstallmentFilter } from "../application/ports";
import { planPayment, planSettlement, type InstallmentTerms } from "../domain/installment";
import { DrizzleInstallmentRepository } from "./drizzle-installment-repository";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-20";
const cipher = new CccdCipher(randomBytes(32), randomBytes(32));
const ALL: InstallmentFilter = { search: null, cccd: null, status: null };

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
  const repo = (db: Db) =>
    new DrizzleInstallmentRepository(db, new DrizzleCustomerWriter(() => cipher), appendCash, (shopId, cccd) => cipher.hash(shopId, cccd));

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

      const page1 = await repo(db).list(actor.shopId, ALL, TODAY, null, 2);
      expect(page1.map((r) => r.code)).toEqual(["TG-3", "TG-2"]);
      expect(page1[0]).toMatchObject({ customerPhone: "093****552", status: "active", deleted: false, periodDays: 2 });
      expect(page1[0].amountGiven.toBigInt()).toBe(4_000_000n);
      const page2 = await repo(db).list(actor.shopId, ALL, TODAY, page1[1].id, 2);
      expect(page2.map((r) => r.code)).toEqual(["TG-1"]);
      expect((await repo(db).list(other.shopId, ALL, TODAY, null, 10)).map((r) => r.code)).toEqual(["TG-1"]);
    }));

  /** Id hợp đồng theo mã trong cửa hàng. */
  const idOf = async (db: Db, actor: Actor, code: string) =>
    (await rows<{ id: string }>(db, sql`SELECT id FROM installment_contracts WHERE shop_id = ${actor.shopId} AND code = ${code}`))[0].id;

  /** Thu `amount` qua domain (như use case) rồi ghi; `kind = close` là tất toán. */
  async function pay(db: Db, actor: Actor, contractId: string, amount: number, kind: "pay" | "close" = "pay") {
    const record = await repo(db).findRecord(actor.shopId, contractId);
    if (!record) throw new Error("không thấy hợp đồng");
    const plan = kind === "pay" ? planPayment(record, Money.fromNumber(amount)) : planSettlement(record, Money.fromNumber(amount));
    if (!plan.ok) throw new Error(plan.error);
    return repo(db).recordPayment(actor, { contractId, kind, payment: plan.value, expectedPaid: record.amountPaid, businessDate: TODAY });
  }

  /** Truy vấn đối soát (data-model mục 4): amount_paid = Σ installment_payment chưa đảo. */
  async function reconcile(db: Db, contractId: string) {
    const [row] = await rows<{ stored: string; ledger: string }>(
      db,
      sql`SELECT c.amount_paid::text AS stored, coalesce((
            SELECT sum(t.amount) FROM cash_transactions t
            WHERE t.installment_contract_id = c.id AND t.type = 'installment_payment'
              AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id)
          ), 0)::text AS ledger
          FROM installment_contracts c WHERE c.id = ${contractId}`,
    );
    expect(row.stored).toBe(row.ledger);
  }

  it("đóng tiền góp: cộng đã thu, dòng thu chung thao tác pay, audit; thu đủ thì đóng hợp đồng", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const id = await idOf(db, actor, "TG-1");
      expect(await pay(db, actor, id, 450_000)).toBe(true);
      await reconcile(db, id);
      expect((await repo(db).findRecord(actor.shopId, id))?.amountPaid.toBigInt()).toBe(450_000n);

      const payments = await repo(db).listPayments(actor.shopId, id);
      expect(payments.map((x) => [x.on, x.amount.toBigInt()])).toEqual([[TODAY, 450_000n]]);
      const history = await repo(db).listTransactions(actor.shopId, id, 10);
      expect(history.map((t) => [t.type, t.operationKind, t.amount.toBigInt()])).toEqual([
        ["installment_payment", "pay", 450_000n],
        ["installment_disbursement", "disbursement", -4_000_000n],
      ]);

      expect(await pay(db, actor, id, 4_550_000)).toBe(true);
      const detail = await repo(db).findDetail(actor.shopId, id);
      expect(detail).toMatchObject({ status: "closed", closedOn: expect.any(String), deleted: null, customerName: "Đỗ Minh Tâm" });
      expect(detail?.ledgerNet.toBigInt()).toBe(1_000_000n);
      await reconcile(db, id);
      const audit = await rows<{ action: string }>(
        db,
        sql`SELECT action FROM audit_logs WHERE entity = 'installment_contract' AND entity_id = ${id} ORDER BY at, action`,
      );
      expect(audit.map((a) => a.action).sort()).toEqual(["create", "pay", "pay"]);
    }));

  it("khoá lạc quan: số đã thu đổi, hợp đồng đã đóng hoặc cửa hàng khác thì không ghi", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const other = await seedShop(db);
      await repo(db).create(actor, draft());
      const id = await idOf(db, actor, "TG-1");
      const record = await repo(db).findRecord(actor.shopId, id);
      const plan = planPayment(record!, Money.fromNumber(200_000));
      if (!plan.ok) throw new Error(plan.error);
      const write = (who: Actor) =>
        repo(db).recordPayment(who, { contractId: id, kind: "pay", payment: plan.value, expectedPaid: Money.ZERO, businessDate: TODAY });

      expect(await write(other)).toBe(false);
      expect(await repo(db).findRecord(other.shopId, id)).toBeNull();
      expect(await repo(db).findDetail(other.shopId, id)).toBeNull();
      expect(await repo(db).listTransactions(other.shopId, id, 10)).toEqual([]);
      expect(await write(actor)).toBe(true);
      expect(await write(actor)).toBe(false); // expectedPaid 0 đã cũ.
      await reconcile(db, id);
    }));

  it("tất toán thu 0 đồng: đóng hợp đồng, có thao tác nhưng không có dòng sổ két", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const id = await idOf(db, actor, "TG-1");
      expect(await pay(db, actor, id, 0, "close")).toBe(true);
      expect((await repo(db).findRecord(actor.shopId, id))?.status).toBe("closed");
      const ops = await rows<{ kind: string }>(
        db,
        sql`SELECT kind FROM installment_operations WHERE installment_contract_id = ${id} ORDER BY created_at`,
      );
      expect(ops.map((o) => o.kind)).toEqual(["disbursement", "close"]);
      expect(await repo(db).listPayments(actor.shopId, id)).toEqual([]);
    }));

  it("huỷ lần lượt từ mới về cũ: huỷ tất toán mở lại hợp đồng, tính lại đã thu; không huỷ giải ngân", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const other = await seedShop(db);
      await repo(db).create(actor, draft());
      const id = await idOf(db, actor, "TG-1");
      await pay(db, actor, id, 450_000);
      await pay(db, actor, id, 3_000_000, "close");
      const reverseLatest = async (who: Actor = actor) => {
        const latest = await repo(db).findLatestOperation(actor.shopId, id);
        return (
          latest && repo(db).reverseOperation(who, { contractId: id, operationId: latest.id, reason: "nhập nhầm", businessDate: TODAY })
        );
      };

      const closing = await repo(db).findLatestOperation(actor.shopId, id);
      expect(closing).toMatchObject({ kind: "close", createdByName: "Chủ Test" });
      expect(closing?.cashNet.toBigInt()).toBe(3_000_000n);
      expect(await reverseLatest(other)).toBe(false); // cửa hàng khác
      expect(await reverseLatest()).toBe(true);
      expect(await repo(db).findRecord(actor.shopId, id)).toMatchObject({ status: "active" });
      expect((await repo(db).findRecord(actor.shopId, id))?.amountPaid.toBigInt()).toBe(450_000n);
      const [closedAt] = await rows<{ closed_at: unknown }>(db, sql`SELECT closed_at FROM installment_contracts WHERE id = ${id}`);
      expect(closedAt.closed_at).toBeNull();
      await reconcile(db, id);
      // Thao tác đã huỷ không huỷ lại được (đã có thao tác mới nhất khác).
      expect(await repo(db).reverseOperation(actor, { contractId: id, operationId: closing!.id, reason: "x", businessDate: TODAY })).toBe(
        false,
      );

      expect(await reverseLatest()).toBe(true);
      expect((await repo(db).findRecord(actor.shopId, id))?.amountPaid.isZero()).toBe(true);
      expect((await repo(db).findLatestOperation(actor.shopId, id))?.kind).toBe("disbursement");
      expect(await reverseLatest()).toBe(false);

      const history = await repo(db).listTransactions(actor.shopId, id, 10);
      expect(history.filter((t) => t.type === "reversal").map((t) => [t.amount.toBigInt(), t.note])).toEqual([
        [-450_000n, "nhập nhầm"],
        [-3_000_000n, "nhập nhầm"],
      ]);
      expect(history.filter((t) => t.type === "installment_payment").every((t) => t.reversed)).toBe(true);
      expect(await repo(db).listPayments(actor.shopId, id)).toEqual([]);
    }));

  it("xoá hợp đồng: đảo mọi dòng chưa đảo, giữ số liệu, không còn thao tác; cửa hàng khác không xoá được", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const other = await seedShop(db);
      await repo(db).create(actor, draft());
      const id = await idOf(db, actor, "TG-1");
      await pay(db, actor, id, 200_000);
      await pay(db, actor, id, 300_000);
      const latest = await repo(db).findLatestOperation(actor.shopId, id);
      await repo(db).reverseOperation(actor, { contractId: id, operationId: latest!.id, reason: "nhầm", businessDate: TODAY });

      const remove = (who: Actor) => repo(db).deleteContract(who, { contractId: id, reason: "khách huỷ", businessDate: TODAY });
      expect(await remove(other)).toBe(false);
      expect(await remove(actor)).toBe(true);
      expect(await remove(actor)).toBe(false);

      const detail = await repo(db).findDetail(actor.shopId, id);
      expect(detail?.deleted).toEqual({ on: expect.any(String), reason: "khách huỷ" });
      expect(detail?.ledgerNet.isZero()).toBe(true);
      expect(detail?.amountPaid.toBigInt()).toBe(200_000n);
      expect(await repo(db).findRecord(actor.shopId, id)).toBeNull();
      expect(await repo(db).findLatestOperation(actor.shopId, id)).toBeNull();
      expect(await repo(db).list(actor.shopId, ALL, TODAY, null, 10)).toEqual([]);
      // Đảo giải ngân (+4tr) và lần góp còn lại (−200k) chung một operation_id; lần góp đã huỷ không đảo lần nữa.
      const deletion = await rows<{ amount: string; ops: string }>(
        db,
        sql`SELECT sum(amount)::text AS amount, count(DISTINCT operation_id)::text AS ops FROM cash_transactions
            WHERE installment_contract_id = ${id} AND type = 'reversal' AND note = 'khách huỷ'`,
      );
      expect(deletion).toEqual([{ amount: "3800000", ops: "1" }]);
    }));

  it("lọc: tìm mã, tên không dấu, SĐT, CCCD; trạng thái chậm góp, đến hạn hôm nay, đã đóng, đã xoá", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      // TG-1: bắt đầu 10/10, 2 ngày một kỳ: hôm nay 20/10 đã qua hạn 4 kỳ (12, 14, 16, 18) → chậm nếu chưa góp đủ 800.000.
      await repo(db).create(actor, draft({ startDate: "2026-10-10" }, { fullName: "Ngô Văn Tài", phone: "0909111731" }));
      // TG-2: bắt đầu 18/10, kỳ 1 hạn hôm nay.
      await repo(db).create(actor, draft({ startDate: "2026-10-18" }, { fullName: "Huỳnh Thị Ngọc", cccd: "001099012345" }));
      // TG-3: đã đóng; TG-4: đã xoá.
      await repo(db).create(actor, draft());
      await repo(db).create(actor, draft());
      await pay(db, actor, await idOf(db, actor, "TG-3"), 0, "close");
      await repo(db).deleteContract(actor, { contractId: await idOf(db, actor, "TG-4"), reason: "nhầm", businessDate: TODAY });

      const codes = async (filter: Partial<InstallmentFilter>) =>
        (await repo(db).list(actor.shopId, { ...ALL, ...filter }, TODAY, null, 10)).map((r) => r.code);
      expect(await codes({})).toEqual(["TG-3", "TG-2", "TG-1"]);
      expect(await codes({ search: "ngo van" })).toEqual(["TG-1"]);
      expect(await codes({ search: "tg-2" })).toEqual(["TG-2"]);
      expect(await codes({ search: "731" })).toEqual(["TG-1"]);
      expect(await codes({ cccd: "001099012345" })).toEqual(["TG-2"]);
      expect(await codes({ status: "open" })).toEqual(["TG-2", "TG-1"]);
      expect(await codes({ status: "late" })).toEqual(["TG-1"]);
      expect(await codes({ status: "due_today" })).toEqual(["TG-2"]);
      expect(await codes({ status: "closed" })).toEqual(["TG-3"]);
      const deleted = await repo(db).list(actor.shopId, { ...ALL, status: "deleted" }, TODAY, null, 10);
      expect(deleted.map((r) => [r.code, r.deleted])).toEqual([["TG-4", true]]);

      // Góp đủ 4 kỳ đã qua hạn: hết chậm.
      await pay(db, actor, await idOf(db, actor, "TG-1"), 800_000);
      expect(await codes({ status: "late" })).toEqual([]);
    }));

  it("thống kê: hợp đồng đang góp, đã thu tháng này trừ dòng huỷ thu trong tháng; cửa hàng khác không lẫn", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const other = await seedShop(db);
      await repo(db).create(actor, draft({ startDate: "2026-10-10" }));
      await repo(db).create(actor, draft());
      await repo(db).create(actor, draft());
      await repo(db).create(other, draft());
      await pay(db, actor, await idOf(db, actor, "TG-1"), 300_000);
      await pay(db, actor, await idOf(db, actor, "TG-2"), 500_000);
      const second = await idOf(db, actor, "TG-2");
      const latest = await repo(db).findLatestOperation(actor.shopId, second);
      await repo(db).reverseOperation(actor, { contractId: second, operationId: latest!.id, reason: "nhầm", businessDate: TODAY });
      await pay(db, actor, await idOf(db, actor, "TG-3"), 0, "close");
      await pay(db, other, await idOf(db, other, "TG-1"), 100_000);

      const stats = await repo(db).stats(actor.shopId, TODAY, "2026-10-01", "2026-11-01");
      expect(stats).toMatchObject({ openCount: 2, lateCount: 1 });
      expect(stats.givenOpen.toBigInt()).toBe(8_000_000n);
      expect(stats.remainingOpen.toBigInt()).toBe(9_700_000n);
      expect(stats.collectedThisMonth.toBigInt()).toBe(300_000n);
      const nextMonth = await repo(db).stats(actor.shopId, TODAY, "2026-11-01", "2026-12-01");
      expect(nextMonth.collectedThisMonth.isZero()).toBe(true);
    }));

  it("đến hạn: chậm góp và kỳ tới ≤ ngày cuối cửa sổ, hạn sớm nhất trước; bỏ đã đóng, đã xoá, cửa hàng khác", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const other = await seedShop(db);
      // TG-1: bắt đầu 10/10, chưa góp: kỳ 1 hạn 12/10 (chậm). TG-2: bắt đầu hôm nay, kỳ 1 hạn 22/10.
      await repo(db).create(actor, draft({ startDate: "2026-10-10" }));
      await repo(db).create(actor, draft());
      // TG-3: kỳ 10 ngày, hạn 30/10, ngoài cửa sổ. TG-4 đã đóng, TG-5 đã xoá (đều chậm nếu còn mở).
      await repo(db).create(actor, draft({ periodDays: 10 }));
      await repo(db).create(actor, draft({ startDate: "2026-10-10" }));
      await repo(db).create(actor, draft({ startDate: "2026-10-10" }));
      await pay(db, actor, await idOf(db, actor, "TG-4"), 0, "close");
      await repo(db).deleteContract(actor, { contractId: await idOf(db, actor, "TG-5"), reason: "nhầm", businessDate: TODAY });
      await repo(db).create(other, draft({ startDate: "2026-10-10" }));

      const due = await repo(db).listDue(actor.shopId, "2026-10-23", 10);
      expect(due.map((r) => [r.code, r.startDate])).toEqual([
        ["TG-1", "2026-10-10"],
        ["TG-2", TODAY],
      ]);
      expect(due[0].amountPaid.isZero()).toBe(true);
      expect(await repo(db).listDue(actor.shopId, "2026-10-23", 1)).toHaveLength(1);
    }));
});
