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
import type { Actor, ContractDraft, ContractFilter, CreatedContract } from "../application/ports";
import { planDisbursement, type ContractTerms } from "../domain/contract";
import { DrizzleContractRepository } from "./drizzle-contract-repository";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-20";
const cipher = new CccdCipher(randomBytes(32), randomBytes(32));
const ALL: ContractFilter = { search: null, cccd: null, kind: null, status: null };

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
    const operationId = op.operationId ?? crypto.randomUUID();
    for (const e of entries) {
      // Bút toán đảo mang số tiền có dấu của dòng gốc, ghi số đối.
      const outflow = e.type === "disbursement" || e.type === "additional_loan" || e.type === "reversal";
      const amount = outflow ? e.amount.negate().toBigInt() : e.amount.toBigInt();
      const contractId = "contractId" in e ? e.contractId : null;
      const [from, to] = e.type === "interest_payment" ? [e.periodFrom, e.periodTo] : [null, null];
      const reversesId = e.type === "reversal" ? e.reversesId : null;
      await tx.execute(
        sql`INSERT INTO cash_transactions
              (shop_id, operation_id, business_date, amount, type, contract_id, period_from, period_to, reverses_id, note, created_by)
            VALUES (${op.shopId}, ${operationId}, ${op.businessDate}, ${amount}, ${e.type}, ${contractId}, ${from}, ${to},
                    ${reversesId}, ${op.note ?? null}, ${op.createdBy})`,
      );
    }
  };
  /** Test không quan tâm KTV: `staffId` rỗng = người thực hiện; bị từ chối thì ném để test hỏng rõ ràng. */
  class TestRepository extends DrizzleContractRepository {
    async create(actor: Actor, draft: ContractDraft): Promise<CreatedContract> {
      const created = await this.createRaw(actor, draft);
      if (typeof created === "string") throw new Error(created);
      return created;
    }

    createRaw(actor: Actor, draft: ContractDraft) {
      return super.create(actor, { ...draft, staffId: draft.staffId || actor.userId });
    }
  }
  const repo = (db: Db) => new TestRepository(db, new DrizzleCustomerWriter(() => cipher), appendCash, (shopId, cccd) => cipher.hash(shopId, cccd));

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
      staffId: "",
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
      const listB = await repo(db).list(b.shopId, ALL, TODAY, null, 50);
      expect(listB.map((c) => c.code)).toEqual(["CD-1"]);
      expect(listB[0].customerName).toBe("Nguyễn Văn A");
    }));

  it("lỗi giữa chừng thì không để lại khách, mã, sổ két (một transaction)", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      // Người thực hiện thuộc cửa hàng khác (KTV hợp lệ): khoá ngoại kép audit (shop_id, user_id) chặn sau khi đã chèn khách.
      await expect(repo(db).create({ shopId: a.shopId, userId: b.userId }, { ...draft(), staffId: a.userId })).rejects.toMatchObject({
        code: "23503",
      });
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
      const page1 = await repo(db).list(actor.shopId, ALL, TODAY, null, 2);
      expect(page1.map((c) => c.code)).toEqual(["CD-3", "CD-2"]);
      expect(page1[0]).toMatchObject({ customerPhone: "091****678", interestRate: 15_000n, interestType: "percent_per_month" });
      expect(page1[0].principal.toBigInt()).toBe(5_000_000n);
      const page2 = await repo(db).list(actor.shopId, ALL, TODAY, page1[1].id, 2);
      expect(page2.map((c) => c.code)).toEqual(["CD-1"]);
    }));

  it("lọc: trạng thái (hạn theo hôm nay, lãi suất 0 không đến hạn), loại, tìm mã / tên / tài sản không dấu / SĐT, CCCD; cách ly cửa hàng", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const make = async (terms: Partial<ContractTerms>, customer: Partial<NewCustomer>, paidUntil: string) => {
        const { code } = await repo(db).create(actor, draft(terms, customer));
        await db.execute(sql`UPDATE contracts SET interest_paid_until = ${paidUntil} WHERE shop_id = ${actor.shopId} AND code = ${code}`);
      };
      // Hôm nay 20/10, kỳ 10 ngày, thu lãi sau: hạn = ngày trả đến + 10.
      await make({ assetName: "Nhẫn vàng 24K" }, { fullName: "Nguyễn Văn Bình", cccd: "001099012345" }, "2026-10-01"); // CD-1 quá hạn
      await make({ kind: "unsecured", assetName: null }, { fullName: "Đặng Thị Hoa", phone: "0987000111" }, "2026-10-10"); // TC-1 hôm nay
      await make({}, { fullName: "Lê Văn C" }, "2026-10-12"); // CD-2 hạn 22/10
      await make({}, { fullName: "Lê Văn D" }, TODAY); // CD-3 hạn 30/10
      await make({ interestRate: 0n }, { fullName: "Lê Văn E" }, "2026-09-01"); // CD-4 lãi suất 0
      await make({}, { fullName: "Lê Văn F" }, TODAY); // CD-5 đã chuộc
      await make({}, { fullName: "Lê Văn G" }, TODAY); // CD-6 đã xoá
      await db.execute(sql`UPDATE contracts SET status = 'closed', closed_at = now() WHERE shop_id = ${actor.shopId} AND code = 'CD-5'`);
      await db.execute(sql`UPDATE contracts SET deleted_at = now(), deleted_by = ${actor.userId}, deleted_reason = 'Nhập sai'
        WHERE shop_id = ${actor.shopId} AND code = 'CD-6'`);

      const codes = async (filter: Partial<ContractFilter>, shopId = actor.shopId) =>
        (await repo(db).list(shopId, { ...ALL, ...filter }, TODAY, null, 50)).map((c) => c.code);
      expect(await codes({})).toEqual(["CD-5", "CD-4", "CD-3", "CD-2", "TC-1", "CD-1"]);
      expect(await codes({ status: "open" })).toEqual(["CD-4", "CD-3", "CD-2", "TC-1", "CD-1"]);
      expect(await codes({ status: "overdue" })).toEqual(["CD-1"]);
      expect(await codes({ status: "due_today" })).toEqual(["TC-1"]);
      expect(await codes({ status: "due_soon" })).toEqual(["CD-2", "TC-1", "CD-1"]);
      expect(await codes({ status: "closed" })).toEqual(["CD-5"]);
      expect(await codes({ status: "deleted" })).toEqual(["CD-6"]);
      expect(await codes({ kind: "unsecured" })).toEqual(["TC-1"]);
      expect(await codes({ kind: "secured", status: "overdue" })).toEqual(["CD-1"]);
      expect(await codes({ search: "nhan vang" })).toEqual(["CD-1"]);
      expect(await codes({ search: "DANG thi" })).toEqual(["TC-1"]);
      expect(await codes({ search: "tc-1" })).toEqual(["TC-1"]);
      expect(await codes({ search: "000 111" })).toEqual(["TC-1"]);
      expect(await codes({ search: "%" })).toEqual([]);
      expect(await codes({ cccd: "001099012345" })).toEqual(["CD-1"]);
      const other = await seedShop(db);
      expect(await codes({}, other.shopId)).toEqual([]);
      expect(await codes({ cccd: "001099012345" }, other.shopId)).toEqual([]);
    }));
  it("đến hạn: hạn theo thu lãi trước/sau, bỏ lãi suất 0 / đã đóng / đã xoá / ngoài khoảng; hạn sớm nhất trước; cách ly cửa hàng", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      // [ngày trả đến, kỳ lãi, thu lãi trước, chỉnh thêm]; hạn ghi ở cuối dòng.
      const cases: [string, number, boolean, string?][] = [
        ["2026-10-01", 10, false], // CD-1 hạn 11/10, quá hạn
        ["2026-10-23", 10, true], // CD-2 hạn 23/10 (đúng mốc)
        ["2026-10-20", 10, false], // CD-3 hạn 30/10, ngoài khoảng
        ["2026-10-01", 10, false, "interest_rate = 0"], // CD-4 lãi suất 0
        ["2026-10-01", 10, false, "status = 'closed', closed_at = now(), outstanding_principal = 0"], // CD-5 đã đóng
        ["2026-10-01", 10, false, `deleted_at = now(), deleted_by = '${actor.userId}', deleted_reason = 'Nhập sai'`], // CD-6 đã xoá
        ["2026-10-15", 5, false], // CD-7 hạn 20/10
        ["2026-10-20", 4, false], // CD-8 hạn 24/10, ngoài khoảng
      ];
      for (const [paidUntil, period, prepaid, extra] of cases) {
        await repo(db).create(actor, draft());
        await db.execute(
          sql`UPDATE contracts SET interest_paid_until = ${paidUntil}, interest_period_days = ${period}, prepaid_interest = ${prepaid}
              WHERE shop_id = ${actor.shopId} AND code = (SELECT 'CD-' || count(*) FROM contracts WHERE shop_id = ${actor.shopId})`,
        );
        if (extra) {
          await db.execute(
            sql`UPDATE contracts SET ${sql.raw(extra)}
                WHERE shop_id = ${actor.shopId} AND code = (SELECT 'CD-' || count(*) FROM contracts WHERE shop_id = ${actor.shopId})`,
          );
        }
      }
      const due = await repo(db).listDue(actor.shopId, "2026-10-23", 10);
      expect(due.map((c) => c.code)).toEqual(["CD-1", "CD-7", "CD-2"]);
      expect(due[0]).toMatchObject({ customerName: "Nguyễn Văn A", interestRate: 30_000n, interestPeriodDays: 10, prepaidInterest: false });
      expect(due[0].outstandingPrincipal.toBigInt()).toBe(5_000_000n);
      expect((await repo(db).listDue(actor.shopId, "2026-10-23", 2)).map((c) => c.code)).toEqual(["CD-1", "CD-7"]);

      const other = await seedShop(db);
      expect(await repo(db).listDue(other.shopId, "2026-10-23", 10)).toEqual([]);
    }));

  it("đóng lãi: dời ngày trả đến, một dòng thu lãi, audit; khớp đối soát; lặp lại cùng kỳ thì không ghi", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const payment = { from: TODAY, to: "2026-10-30", amount: Money.fromNumber(150_000) };
      const pay = { contractId: id, payment, expectedOutstanding: Money.fromNumber(5_000_000), businessDate: "2026-10-21" };

      expect(await repo(db).recordInterestPayment(actor, pay)).toBe(true);
      expect(await repo(db).recordInterestPayment(actor, pay)).toBe(false);
      // Đúng ngày trả đến mới nhưng gốc lúc tính lệch DB: không ghi.
      const nextPeriod = { ...payment, from: "2026-10-30", to: "2026-11-09" };
      expect(await repo(db).recordInterestPayment(actor, { ...pay, payment: nextPeriod, expectedOutstanding: Money.fromNumber(4_000_000) })).toBe(false);

      const standing = await repo(db).findStanding(actor.shopId, id);
      expect(standing).toMatchObject({ status: "active", interestPaidUntil: "2026-10-30" });
      const cash = await rows<{ type: string; amount: string; business_date: string; period_from: string; period_to: string }>(
        db,
        sql`SELECT type, amount::text, business_date::text, period_from::text, period_to::text FROM cash_transactions
            WHERE shop_id = ${actor.shopId} AND type = 'interest_payment'`,
      );
      expect(cash).toEqual([{ type: "interest_payment", amount: "150000", business_date: "2026-10-21", period_from: TODAY, period_to: "2026-10-30" }]);
      const [reconcile] = await rows<{ paid_until: string }>(
        db,
        sql`SELECT coalesce(max(t.period_to) FILTER (WHERE t.type = 'interest_payment'), c.loan_date)::text AS paid_until
            FROM contracts c LEFT JOIN cash_transactions t ON t.shop_id = c.shop_id AND t.contract_id = c.id
            WHERE c.id = ${id} GROUP BY c.id`,
      );
      expect(reconcile.paid_until).toBe("2026-10-30");
      const audits = await rows<{ action: string; changed_fields: string[] }>(
        db,
        sql`SELECT action, changed_fields FROM audit_logs WHERE entity_id = ${id} AND action = 'pay_interest'`,
      );
      expect(audits).toEqual([{ action: "pay_interest", changed_fields: ["interest_paid_until"] }]);
    }));

  it("chuộc đồ: dòng lãi + dòng gốc chung operation_id, gốc về 0, đóng hợp đồng, audit; khớp đối soát; lặp lại thì không ghi", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const redeem = {
        contractId: id,
        redemption: {
          interest: { from: TODAY, to: "2026-10-25", amount: Money.fromNumber(75_000) },
          principal: Money.fromNumber(5_000_000),
        },
        expectedPaidUntil: TODAY,
        businessDate: "2026-10-25",
      };
      // Gốc lúc tính lệch DB: không ghi.
      const wrongPrincipal = { ...redeem, redemption: { ...redeem.redemption, principal: Money.fromNumber(4_000_000) } };
      expect(await repo(db).recordRedemption(actor, wrongPrincipal)).toBe(false);
      expect(await repo(db).recordRedemption(actor, redeem)).toBe(true);
      expect(await repo(db).recordRedemption(actor, redeem)).toBe(false);

      const [contract] = await rows<{ status: string; outstanding_principal: string; interest_paid_until: string; closed: boolean }>(
        db,
        sql`SELECT status, outstanding_principal::text, interest_paid_until::text, closed_at IS NOT NULL AS closed FROM contracts WHERE id = ${id}`,
      );
      expect(contract).toEqual({ status: "closed", outstanding_principal: "0", interest_paid_until: "2026-10-25", closed: true });
      const cash = await rows<{ type: string; amount: string; business_date: string; operation_id: string }>(
        db,
        sql`SELECT type, amount::text, business_date::text, operation_id FROM cash_transactions
            WHERE shop_id = ${actor.shopId} AND type IN ('interest_payment', 'principal_repayment') ORDER BY type`,
      );
      expect(cash.map((row) => ({ type: row.type, amount: row.amount, business_date: row.business_date }))).toEqual([
        { type: "interest_payment", amount: "75000", business_date: "2026-10-25" },
        { type: "principal_repayment", amount: "5000000", business_date: "2026-10-25" },
      ]);
      expect(cash[0].operation_id).toBe(cash[1].operation_id);
      const [reconcile] = await rows<{ outstanding: string; paid_until: string }>(
        db,
        sql`SELECT (c.principal - coalesce(sum(t.amount) FILTER (WHERE t.type = 'principal_repayment'), 0))::text AS outstanding,
                   coalesce(max(t.period_to) FILTER (WHERE t.type = 'interest_payment'), c.loan_date)::text AS paid_until
            FROM contracts c LEFT JOIN cash_transactions t ON t.shop_id = c.shop_id AND t.contract_id = c.id
            WHERE c.id = ${id} GROUP BY c.id`,
      );
      expect(reconcile).toEqual({ outstanding: "0", paid_until: "2026-10-25" });
      const audits = await rows<{ changed_fields: string[] }>(
        db,
        sql`SELECT changed_fields FROM audit_logs WHERE entity_id = ${id} AND action = 'close'`,
      );
      expect(audits).toEqual([{ changed_fields: ["status", "outstanding_principal", "interest_paid_until"] }]);
      expect((await repo(db).findDetail(actor.shopId, id))?.closedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }));

  it("chuộc đồ không thu lãi (giảm hết): chỉ dòng gốc, ngày trả đến giữ nguyên", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const redeem = {
        contractId: id,
        redemption: { interest: null, principal: Money.fromNumber(5_000_000) },
        expectedPaidUntil: TODAY,
        businessDate: TODAY,
      };
      expect(await repo(db).recordRedemption(actor, redeem)).toBe(true);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({ status: "closed", interestPaidUntil: TODAY });
      const cash = await rows<{ type: string }>(
        db,
        sql`SELECT type FROM cash_transactions WHERE contract_id = ${id} AND type <> 'disbursement'`,
      );
      expect(cash).toEqual([{ type: "principal_repayment" }]);
    }));

  it("chi tiết: khách, KTV, lãi đã thu không tính dòng đã đảo; lịch sử mới nhất trước", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft({ prepaidInterest: true }, { cccd: "001099012345", address: "12 Lê Lợi" }));
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      await repo(db).recordInterestPayment(actor, {
        contractId: id,
        payment: { from: "2026-10-30", to: "2026-11-09", amount: Money.fromNumber(150_000) },
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: TODAY,
      });
      // Đảo lần đóng lãi thứ hai bằng SQL (nghiệp vụ huỷ chưa có ở lát này).
      await db.execute(
        sql`INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, reverses_id, created_by)
            SELECT shop_id, gen_random_uuid(), business_date, -amount, 'reversal', contract_id, id, created_by
            FROM cash_transactions WHERE contract_id = ${id} AND period_from = '2026-10-30'`,
      );

      const detail = await repo(db).findDetail(actor.shopId, id);
      expect(detail).toMatchObject({
        code: "CD-1",
        customerName: "Nguyễn Văn A",
        staffName: "Chủ Test",
        termDays: 30,
        customer: { phone: "0912345678", address: "12 Lê Lợi", cccdMasked: "********2345" },
      });
      expect(detail?.interestPaid.toBigInt()).toBe(150_000n);

      const history = await repo(db).listTransactions(actor.shopId, id, 10);
      expect(history.map((h) => [h.type, h.amount.toBigInt(), h.reversed])).toEqual([
        ["reversal", -150_000n, false],
        ["interest_payment", 150_000n, true],
        ["interest_payment", 150_000n, false],
        ["disbursement", -5_000_000n, false],
      ]);
      expect(history[0].createdByName).toBe("Chủ Test");
    }));

  it("cách ly cửa hàng: B không đọc, không đóng lãi, không chuộc được hợp đồng của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      await repo(db).create(a, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${a.shopId}`);
      expect(await repo(db).findDetail(b.shopId, id)).toBeNull();
      expect(await repo(db).findStanding(b.shopId, id)).toBeNull();
      expect(await repo(db).listTransactions(b.shopId, id, 10)).toEqual([]);
      const pay = {
        contractId: id,
        payment: { from: TODAY, to: "2026-10-30", amount: Money.fromNumber(150_000) },
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: TODAY,
      };
      expect(await repo(db).recordInterestPayment(b, pay)).toBe(false);
      const redeem = {
        contractId: id,
        redemption: { interest: null, principal: Money.fromNumber(5_000_000) },
        expectedPaidUntil: TODAY,
        businessDate: TODAY,
      };
      expect(await repo(db).recordRedemption(b, redeem)).toBe(false);
      const principalChange = {
        contractId: id,
        direction: "repayment" as const,
        change: { interest: null, amount: Money.fromNumber(1_000_000), outstandingAfter: Money.fromNumber(4_000_000) },
        expectedPaidUntil: TODAY,
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: TODAY,
      };
      expect(await repo(db).recordPrincipalChange(b, principalChange)).toBe(false);
      const extension = {
        contractId: id,
        extension: { termDaysAfter: 60, interest: null },
        expectedTermDays: 30,
        expectedPaidUntil: TODAY,
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: TODAY,
      };
      expect(await repo(db).recordExtension(b, extension)).toBe(false);
      expect(await repo(db).findStanding(a.shopId, id)).toMatchObject({
        status: "active",
        interestPaidUntil: TODAY,
        termDays: 30,
        outstandingPrincipal: Money.fromNumber(5_000_000),
      });
    }));

  // Đối soát data-model mục 4 trên các dòng chưa bị đảo.
  const reconcile = (db: Db, id: string) =>
    rows<{ outstanding: string; paid_until: string }>(
      db,
      sql`SELECT (c.principal - coalesce(sum(t.amount) FILTER (WHERE t.type IN ('additional_loan', 'principal_repayment')), 0))::text
                   AS outstanding,
                 coalesce(max(t.period_to) FILTER (WHERE t.type = 'interest_payment'), c.loan_date)::text AS paid_until
          FROM contracts c LEFT JOIN cash_transactions t ON t.shop_id = c.shop_id AND t.contract_id = c.id
            AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id)
          WHERE c.id = ${id} GROUP BY c.id`,
    );

  it("trả bớt gốc rồi vay thêm: dòng lãi + dòng gốc chung operation_id, gốc mới, audit; khớp đối soát; lặp lại thì không ghi", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const repay = {
        contractId: id,
        direction: "repayment" as const,
        change: {
          interest: { from: TODAY, to: "2026-10-25", amount: Money.fromNumber(75_000) },
          amount: Money.fromNumber(2_000_000),
          outstandingAfter: Money.fromNumber(3_000_000),
        },
        expectedPaidUntil: TODAY,
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: "2026-10-25",
      };
      expect(await repo(db).recordPrincipalChange(actor, { ...repay, expectedOutstanding: Money.fromNumber(4_000_000) })).toBe(false);
      expect(await repo(db).recordPrincipalChange(actor, repay)).toBe(true);
      expect(await repo(db).recordPrincipalChange(actor, repay)).toBe(false);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({
        status: "active",
        interestPaidUntil: "2026-10-25",
        outstandingPrincipal: Money.fromNumber(3_000_000),
      });

      // Vay thêm khi lãi đã trả vượt ngày thao tác: lãi bổ sung [hôm nay, ngày trả đến), ngày trả đến giữ nguyên.
      const borrow = {
        contractId: id,
        direction: "additional_loan" as const,
        change: {
          interest: { from: "2026-10-22", to: "2026-10-25", amount: Money.fromNumber(9_000) },
          amount: Money.fromNumber(1_000_000),
          outstandingAfter: Money.fromNumber(4_000_000),
        },
        expectedPaidUntil: "2026-10-25",
        expectedOutstanding: Money.fromNumber(3_000_000),
        businessDate: "2026-10-22",
      };
      expect(await repo(db).recordPrincipalChange(actor, borrow)).toBe(true);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({
        interestPaidUntil: "2026-10-25",
        outstandingPrincipal: Money.fromNumber(4_000_000),
      });

      const cash = await rows<{ type: string; amount: string; operation_id: string }>(
        db,
        sql`SELECT type, amount::text, operation_id FROM cash_transactions
            WHERE contract_id = ${id} AND type <> 'disbursement' ORDER BY business_date DESC, type`,
      );
      expect(cash.map(({ type, amount }) => ({ type, amount }))).toEqual([
        { type: "interest_payment", amount: "75000" },
        { type: "principal_repayment", amount: "2000000" },
        { type: "additional_loan", amount: "-1000000" },
        { type: "interest_payment", amount: "9000" },
      ]);
      expect(cash[0].operation_id).toBe(cash[1].operation_id);
      expect(cash[2].operation_id).toBe(cash[3].operation_id);
      expect(await reconcile(db, id)).toEqual([{ outstanding: "4000000", paid_until: "2026-10-25" }]);
      const audits = await rows<{ action: string; changed_fields: string[] }>(
        db,
        sql`SELECT action, changed_fields FROM audit_logs WHERE entity_id = ${id} AND action <> 'create' ORDER BY action`,
      );
      expect(audits).toEqual([
        { action: "additional_loan", changed_fields: ["outstanding_principal"] },
        { action: "repay_principal", changed_fields: ["outstanding_principal", "interest_paid_until"] },
      ]);
    }));

  it("gia hạn: đổi số ngày vay, có thu lãi thì một dòng đóng lãi, audit; số ngày vay đã đổi thì không ghi", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const extend = {
        contractId: id,
        extension: { termDaysAfter: 45, interest: null },
        expectedTermDays: 30,
        expectedPaidUntil: TODAY,
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: TODAY,
      };
      expect(await repo(db).recordExtension(actor, extend)).toBe(true);
      expect(await repo(db).recordExtension(actor, extend)).toBe(false);
      const paid = {
        ...extend,
        extension: { termDaysAfter: 60, interest: { from: TODAY, to: "2026-10-25", amount: Money.fromNumber(75_000) } },
        expectedTermDays: 45,
        businessDate: "2026-10-25",
      };
      expect(await repo(db).recordExtension(actor, paid)).toBe(true);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({ termDays: 60, interestPaidUntil: "2026-10-25" });
      const cash = await rows<{ type: string; amount: string }>(
        db,
        sql`SELECT type, amount::text FROM cash_transactions WHERE contract_id = ${id} AND type <> 'disbursement'`,
      );
      expect(cash).toEqual([{ type: "interest_payment", amount: "75000" }]);
      expect(await reconcile(db, id)).toEqual([{ outstanding: "5000000", paid_until: "2026-10-25" }]);
      const audits = await rows<{ changed_fields: string[] }>(
        db,
        sql`SELECT changed_fields FROM audit_logs WHERE entity_id = ${id} AND action = 'extend'`,
      );
      expect(audits.map((a) => a.changed_fields).sort()).toEqual([["term_days"], ["term_days", "interest_paid_until"]]);
    }));

  // Các thao tác mẫu trên hợp đồng 5tr vay TODAY, thu lãi sau (75.000 đ cho 5 ngày).
  const repayDraft = (id: string) => ({
    contractId: id,
    direction: "repayment" as const,
    change: {
      interest: { from: TODAY, to: "2026-10-25", amount: Money.fromNumber(75_000) },
      amount: Money.fromNumber(2_000_000),
      outstandingAfter: Money.fromNumber(3_000_000),
    },
    expectedPaidUntil: TODAY,
    expectedOutstanding: Money.fromNumber(5_000_000),
    businessDate: "2026-10-25",
  });
  const latestId = async (db: Db, shopId: string, id: string) => (await repo(db).findLatestOperation(shopId, id))?.id ?? "";

  it("thao tác ghi contract_operations, id = operation_id của sổ két; huỷ lần lượt từ mới về cũ, mở lại hợp đồng; khớp đối soát", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      expect(await repo(db).findLatestOperation(actor.shopId, id)).toMatchObject({ kind: "disbursement", cashNet: Money.fromNumber(-5_000_000) });
      const disbursementId = await latestId(db, actor.shopId, id);

      expect(await repo(db).recordPrincipalChange(actor, repayDraft(id))).toBe(true);
      const repayId = await latestId(db, actor.shopId, id);
      const redeem = {
        contractId: id,
        redemption: { interest: null, principal: Money.fromNumber(3_000_000) },
        expectedPaidUntil: "2026-10-25",
        businessDate: "2026-10-26",
      };
      expect(await repo(db).recordRedemption(actor, redeem)).toBe(true);
      const closeOp = await repo(db).findLatestOperation(actor.shopId, id);
      expect(closeOp).toMatchObject({ kind: "close", cashNet: Money.fromNumber(3_000_000) });
      const [linked] = await rows<{ n: string }>(
        db,
        sql`SELECT count(*)::text AS n FROM cash_transactions WHERE operation_id = ${closeOp!.id} AND type = 'principal_repayment'`,
      );
      expect(linked.n).toBe("1");

      // Không phải thao tác mới nhất thì không huỷ.
      const reversal = { contractId: id, reason: "Nhập nhầm", businessDate: "2026-10-27" };
      expect(await repo(db).reverseOperation(actor, { ...reversal, operationId: repayId })).toBe(false);
      expect(await repo(db).reverseOperation(actor, { ...reversal, operationId: closeOp!.id })).toBe(true);
      expect(await repo(db).reverseOperation(actor, { ...reversal, operationId: closeOp!.id })).toBe(false);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({
        status: "active",
        outstandingPrincipal: Money.fromNumber(3_000_000),
        interestPaidUntil: "2026-10-25",
      });
      const [reopened] = await rows<{ closed: boolean }>(db, sql`SELECT closed_at IS NOT NULL AS closed FROM contracts WHERE id = ${id}`);
      expect(reopened.closed).toBe(false);

      expect(await latestId(db, actor.shopId, id)).toBe(repayId);
      expect(await repo(db).reverseOperation(actor, { ...reversal, operationId: repayId })).toBe(true);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({
        outstandingPrincipal: Money.fromNumber(5_000_000),
        interestPaidUntil: TODAY,
      });
      expect(await reconcile(db, id)).toEqual([{ outstanding: "5000000", paid_until: TODAY }]);

      // Còn lại giải ngân: không huỷ được.
      expect(await latestId(db, actor.shopId, id)).toBe(disbursementId);
      expect(await repo(db).reverseOperation(actor, { ...reversal, operationId: disbursementId })).toBe(false);

      const cash = await rows<{ amount: string; note: string | null; business_date: string }>(
        db,
        sql`SELECT amount::text, note, business_date::text FROM cash_transactions WHERE contract_id = ${id} AND type = 'reversal' ORDER BY cash_transactions.amount`,
      );
      expect(cash).toEqual([
        { amount: "-3000000", note: "Nhập nhầm", business_date: "2026-10-27" },
        { amount: "-2000000", note: "Nhập nhầm", business_date: "2026-10-27" },
        { amount: "-75000", note: "Nhập nhầm", business_date: "2026-10-27" },
      ]);
      const detail = await repo(db).findDetail(actor.shopId, id);
      expect(detail?.interestPaid.toBigInt()).toBe(0n);
      expect(detail?.ledgerNet.toBigInt()).toBe(-5_000_000n);
      const audits = await rows<{ changed_fields: string[] }>(
        db,
        sql`SELECT changed_fields FROM audit_logs WHERE entity_id = ${id} AND action = 'reverse'`,
      );
      expect(audits).toHaveLength(2);
    }));

  it("huỷ gia hạn (không có dòng sổ két): trừ lại số ngày vay", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const extend = {
        contractId: id,
        extension: { termDaysAfter: 45, interest: null },
        expectedTermDays: 30,
        expectedPaidUntil: TODAY,
        expectedOutstanding: Money.fromNumber(5_000_000),
        businessDate: TODAY,
      };
      expect(await repo(db).recordExtension(actor, extend)).toBe(true);
      const op = await repo(db).findLatestOperation(actor.shopId, id);
      expect(op).toMatchObject({ kind: "extend", extraDays: 15, cashNet: Money.ZERO });
      expect(await repo(db).reverseOperation(actor, { contractId: id, operationId: op!.id, reason: "Gia hạn nhầm", businessDate: TODAY })).toBe(true);
      expect(await repo(db).findStanding(actor.shopId, id)).toMatchObject({ termDays: 30, interestPaidUntil: TODAY });
    }));

  it("xoá hợp đồng: đảo mọi dòng chưa đảo trong một thao tác, ghi lý do; vẫn xem được, không thao tác được, không có trong danh sách", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      await repo(db).create(actor, draft({ prepaidInterest: true }));
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${actor.shopId}`);
      const deletion = { contractId: id, reason: "Trùng hồ sơ", businessDate: "2026-10-21" };
      expect(await repo(db).deleteContract(actor, deletion)).toBe(true);
      expect(await repo(db).deleteContract(actor, deletion)).toBe(false);

      const cash = await rows<{ net: string; operations: string; reversals: string }>(
        db,
        sql`SELECT sum(amount)::text AS net, count(DISTINCT operation_id) FILTER (WHERE type = 'reversal')::text AS operations,
                   count(*) FILTER (WHERE type = 'reversal')::text AS reversals
            FROM cash_transactions WHERE contract_id = ${id}`,
      );
      expect(cash).toEqual([{ net: "0", operations: "1", reversals: "2" }]);
      const detail = await repo(db).findDetail(actor.shopId, id);
      expect(detail?.deleted).toEqual({ on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), reason: "Trùng hồ sơ" });
      expect(detail?.ledgerNet.toBigInt()).toBe(0n);
      expect(await repo(db).findStanding(actor.shopId, id)).toBeNull();
      expect(await repo(db).findLatestOperation(actor.shopId, id)).toBeNull();
      expect(await repo(db).list(actor.shopId, ALL, TODAY, null, 10)).toEqual([]);
      const [deleted] = await repo(db).list(actor.shopId, { ...ALL, status: "deleted" }, TODAY, null, 10);
      expect(deleted).toMatchObject({ id, deleted: true });
      const audits = await rows<{ changed_fields: string[] }>(db, sql`SELECT changed_fields FROM audit_logs WHERE entity_id = ${id} AND action = 'delete'`);
      expect(audits).toEqual([{ changed_fields: ["deleted_at", "deleted_reason"] }]);
    }));

  it("cách ly cửa hàng: B không thấy thao tác, không huỷ, không xoá được hợp đồng của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      await repo(db).create(a, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${a.shopId}`);
      expect(await repo(db).recordPrincipalChange(a, repayDraft(id))).toBe(true);
      const opId = await latestId(db, a.shopId, id);
      expect(await repo(db).findLatestOperation(b.shopId, id)).toBeNull();
      expect(await repo(db).reverseOperation(b, { contractId: id, operationId: opId, reason: "x", businessDate: TODAY })).toBe(false);
      expect(await repo(db).deleteContract(b, { contractId: id, reason: "x", businessDate: TODAY })).toBe(false);
      expect(await repo(db).findStanding(a.shopId, id)).toMatchObject({ outstandingPrincipal: Money.fromNumber(3_000_000) });
      expect(await latestId(db, a.shopId, id)).toBe(opId);
    }));

  it("sửa thông tin: đổi tên tài sản / ghi chú, audit edit, không sinh giao dịch; giá trị đã đổi, đã xoá, cửa hàng khác thì không ghi", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      await repo(db).create(a, draft());
      const [{ id }] = await rows<{ id: string }>(db, sql`SELECT id FROM contracts WHERE shop_id = ${a.shopId}`);
      const edit = {
        contractId: id,
        expected: { assetName: "Honda Vision", note: null },
        info: { assetName: "Honda Vision 2022", note: "Trầy yếm" },
        changed: ["assetName" as const, "note" as const],
      };
      expect(await repo(db).recordEdit(b, edit)).toBe(false);
      expect(await repo(db).recordEdit(a, edit)).toBe(true);
      expect(await repo(db).recordEdit(a, edit)).toBe(false);
      expect(await repo(db).findDetail(a.shopId, id)).toMatchObject({ assetName: "Honda Vision 2022", note: "Trầy yếm" });
      const audits = await rows<{ changed_fields: string[] }>(db, sql`SELECT changed_fields FROM audit_logs WHERE entity_id = ${id} AND action = 'edit'`);
      expect(audits).toEqual([{ changed_fields: ["asset_name", "note"] }]);
      const [cash] = await rows<{ n: string }>(db, sql`SELECT count(*)::text AS n FROM cash_transactions WHERE contract_id = ${id}`);
      expect(cash.n).toBe("1");

      expect(await repo(db).deleteContract(a, { contractId: id, reason: "x", businessDate: TODAY })).toBe(true);
      const again = { ...edit, expected: edit.info, info: { assetName: "Xe khác", note: null } };
      expect(await repo(db).recordEdit(a, again)).toBe(false);
    }));

  it("chọn KTV: ghi đúng KTV, audit vẫn ghi người thực hiện; KTV cửa hàng khác hoặc đã khoá bị từ chối, không ghi gì", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      const staffId = `ktv_${Date.now()}_${n++}`;
      const [staff] = await rows<{ id: string }>(
        db,
        sql`INSERT INTO users (shop_id, name, email, username, role) VALUES (${a.shopId}, 'KTV Lan', ${`${staffId}@test.local`}, ${staffId}, 'staff') RETURNING id`,
      );

      await repo(db).create(a, { ...draft(), staffId: staff.id });
      const [contract] = await rows<{ id: string; staff_id: string }>(db, sql`SELECT id, staff_id FROM contracts WHERE shop_id = ${a.shopId}`);
      expect(contract.staff_id).toBe(staff.id);
      const [audit] = await rows<{ user_id: string }>(db, sql`SELECT user_id FROM audit_logs WHERE entity_id = ${contract.id}`);
      expect(audit.user_id).toBe(a.userId);

      expect(await repo(db).createRaw(a, { ...draft(), staffId: b.userId })).toBe("staff_not_found");
      await db.execute(sql`UPDATE users SET is_active = false WHERE id = ${staff.id}`);
      expect(await repo(db).createRaw(a, { ...draft(), staffId: staff.id })).toBe("staff_not_found");
      const [counts] = await rows<{ contracts: number; customers: number }>(
        db,
        sql`SELECT (SELECT count(*)::int FROM contracts WHERE shop_id = ${a.shopId}) AS contracts,
                   (SELECT count(*)::int FROM customers WHERE shop_id = ${a.shopId}) AS customers`,
      );
      expect(counts).toEqual({ contracts: 1, customers: 1 });

      expect(await repo(db).listStaffOptions(a.shopId)).toEqual([{ id: a.userId, name: "Chủ Test", role: "owner" }]);
      await db.execute(sql`UPDATE users SET is_active = true WHERE id = ${staff.id}`);
      expect((await repo(db).listStaffOptions(a.shopId)).map((s) => s.name)).toEqual(["Chủ Test", "KTV Lan"]);
      expect(await repo(db).listStaffOptions(b.shopId)).toEqual([{ id: b.userId, name: "Chủ Test", role: "owner" }]);
    }));

  it("khách có sẵn: gắn hợp đồng vào khách đó, không tạo khách mới; khách cửa hàng khác bị từ chối", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      const first = await repo(db).create(a, draft({}, { cccd: "001099012345", fullName: "Trần Thị B" }));
      const existingId = first.customer.id;

      const summary = await repo(db).findCustomerSummary(a.shopId, existingId);
      expect(summary).toEqual({ id: existingId, fullName: "Trần Thị B", phone: "0912345678", cccdMasked: "********2345" });
      expect(await repo(db).findCustomerSummary(b.shopId, existingId)).toBeNull();

      const second = await repo(db).create(a, { ...draft(), customer: { existingId } });
      expect(second.customer).toEqual({ id: existingId, fullName: "Trần Thị B", reused: true });
      const [counts] = await rows<{ customers: number; contracts: number }>(
        db,
        sql`SELECT (SELECT count(*)::int FROM customers WHERE shop_id = ${a.shopId}) AS customers,
                   (SELECT count(*)::int FROM contracts WHERE shop_id = ${a.shopId} AND customer_id = ${existingId}) AS contracts`,
      );
      expect(counts).toEqual({ customers: 1, contracts: 2 });

      expect(await repo(db).createRaw(b, { ...draft(), customer: { existingId } })).toBe("customer_not_found");
      const [inB] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM contracts WHERE shop_id = ${b.shopId}`);
      expect(inB.n).toBe(0);
    }));
});
