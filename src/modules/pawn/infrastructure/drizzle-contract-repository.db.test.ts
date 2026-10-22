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
      expect(await repo(db).list(actor.shopId, null, 10)).toEqual([]);
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
});
