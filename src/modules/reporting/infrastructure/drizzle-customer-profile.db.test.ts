// Chi tiết khách hàng trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import {
  inRollbackTx,
  seedCash,
  seedContract,
  seedCustomer,
  seedInstallment,
  seedShop,
} from "./db-test-kit";
import { DrizzleCustomerProfile } from "./drizzle-customer-profile";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-22";

describe.skipIf(!url)("DrizzleCustomerProfile", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const inTx = (fn: (db: Db) => Promise<void>) => inRollbackTx(pool, fn);

  it("số liệu: HĐ mở, quá hạn, dư nợ chỉ tính hợp đồng mở chưa xoá (cả trả góp); lãi đã đóng bỏ dòng đã đảo; SĐT đầy đủ", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const binh = await seedCustomer(db, shop.shopId, {
        fullName: "Nguyễn Văn Bình",
        phone: "0912345678",
        address: "12 Lê Lợi",
      });
      const overdue = await seedContract(db, shop, {
        customerId: binh,
        outstanding: 5_000_000,
        paidUntil: "2026-10-01",
      }); // hạn 11/10
      await seedContract(db, shop, {
        customerId: binh,
        outstanding: 3_000_000,
        paidUntil: "2026-10-20",
      }); // hạn 30/10
      await seedContract(db, shop, {
        customerId: binh,
        outstanding: 0,
        paidUntil: "2026-09-01",
        closed: true,
      });
      const deleted = await seedContract(db, shop, {
        customerId: binh,
        outstanding: 9_000_000,
        paidUntil: "2026-09-01",
        deleted: true,
      });
      await seedCash(db, shop, {
        date: "2026-10-01",
        type: "interest_payment",
        amount: 300_000,
        contractId: overdue,
      });
      const undone = await seedCash(db, shop, {
        date: "2026-10-02",
        type: "interest_payment",
        amount: 200_000,
        contractId: overdue,
      });
      await seedCash(db, shop, {
        date: "2026-10-03",
        type: "reversal",
        amount: -200_000,
        contractId: overdue,
        reverses: undone,
      });
      const onDeleted = await seedCash(db, shop, {
        date: "2026-10-04",
        type: "interest_payment",
        amount: 50_000,
        contractId: deleted,
      });
      await seedCash(db, shop, {
        date: "2026-10-05",
        type: "reversal",
        amount: -50_000,
        contractId: deleted,
        reverses: onDeleted,
      });

      // Trả góp: chậm góp (bắt đầu 10/10, chưa góp), đúng hạn (bắt đầu 20/10, góp 400.000), đã đóng, đã xoá.
      await seedInstallment(db, shop, {
        customerId: binh,
        startDate: "2026-10-10",
      });
      await seedInstallment(db, shop, {
        customerId: binh,
        startDate: "2026-10-20",
        paid: 400_000,
      });
      await seedInstallment(db, shop, {
        customerId: binh,
        startDate: "2026-10-01",
        paid: 5_000_000,
        closed: true,
      });
      await seedInstallment(db, shop, {
        customerId: binh,
        startDate: "2026-10-01",
        deleted: true,
      });

      const summary = await new DrizzleCustomerProfile(db).findCustomer(
        shop.shopId,
        binh,
        TODAY,
      );
      expect(summary).toMatchObject({
        fullName: "Nguyễn Văn Bình",
        phone: "0912345678",
        address: "12 Lê Lợi",
        cccdMasked: null,
        openContracts: 4,
        overdueContracts: 2,
      });
      // 8.000.000 gốc + 5.000.000 + 4.600.000 trả góp còn phải thu.
      expect(summary?.debt.toBigInt()).toBe(17_600_000n);
      expect(summary?.interestPaid.toBigInt()).toBe(300_000n);
      expect(summary?.createdAt).toBeInstanceOf(Date);
    }));

  it("bảng hợp đồng gồm cả trả góp, hợp đồng đã đóng / đã xoá, mới nhất trước; hạn chỉ với hợp đồng đang mở", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const open = await seedContract(db, shop, {
        outstanding: 5_000_000,
        paidUntil: "2026-10-01",
      });
      const closed = await seedContract(db, shop, {
        outstanding: 0,
        paidUntil: "2026-09-01",
        closed: true,
      });
      const deleted = await seedContract(db, shop, {
        outstanding: 9_000_000,
        paidUntil: "2026-09-01",
        deleted: true,
      });
      const other = await seedCustomer(db, shop.shopId, {
        fullName: "Khách khác",
      });
      await seedContract(db, shop, {
        customerId: other,
        outstanding: 1_000_000,
        paidUntil: "2026-10-01",
      });

      const late = await seedInstallment(db, shop, { startDate: "2026-10-10" });
      // Bắt đầu 20/10, kỳ 1 hạn 22/10 = hôm nay.
      const dueToday = await seedInstallment(db, shop, {
        startDate: "2026-10-20",
      });
      const settled = await seedInstallment(db, shop, {
        startDate: "2026-10-01",
        paid: 4_500_000,
        closed: true,
      });
      await seedInstallment(db, shop, {
        customerId: other,
        startDate: "2026-10-10",
      });

      const rows = await new DrizzleCustomerProfile(db).listContracts(
        shop.shopId,
        shop.customerId,
        TODAY,
      );
      expect(rows.map((c) => c.id)).toEqual([
        settled,
        dueToday,
        late,
        deleted,
        closed,
        open,
      ]);
      const [r0, r1, r2, r3, r4, r5] = rows;
      if (r0.type !== "installment" || r2.type !== "installment" || r5.type !== "pawn")
        throw new Error("sai loại hợp đồng");
      expect(r0).toMatchObject({ dueStatus: null, deleted: false });
      expect(r0.closedOn).not.toBeNull();
      expect(r0.remaining.isZero()).toBe(true);
      expect(r1).toMatchObject({ dueStatus: "today", closedOn: null });
      expect(r2).toMatchObject({ dueStatus: "late", startDate: "2026-10-10" });
      expect(r2.remaining.toBigInt()).toBe(5_000_000n);
      expect(r2.amountGiven.toBigInt()).toBe(4_000_000n);
      expect(r3).toMatchObject({ deleted: true, nextInterestDue: null });
      expect(r4).toMatchObject({ deleted: false, nextInterestDue: null });
      expect(r4.closedOn).not.toBeNull();
      expect(r5).toMatchObject({
        deleted: false,
        nextInterestDue: "2026-10-11",
        closedOn: null,
        loanDate: "2026-09-01",
      });
      expect(r5.outstandingPrincipal.toBigInt()).toBe(5_000_000n);
    }));

  it("giao dịch gần đây: mọi hợp đồng của khách (cả trả góp), mới nhất trước, giới hạn số dòng, đánh dấu dòng đã đảo", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const a = await seedContract(db, shop, {
        outstanding: 5_000_000,
        paidUntil: "2026-10-01",
      });
      const b = await seedContract(db, shop, {
        outstanding: 3_000_000,
        paidUntil: "2026-10-01",
      });
      const other = await seedCustomer(db, shop.shopId, {
        fullName: "Khách khác",
      });
      const foreign = await seedContract(db, shop, {
        customerId: other,
        outstanding: 1_000_000,
        paidUntil: "2026-10-01",
      });
      await seedCash(db, shop, {
        date: "2026-09-01",
        type: "disbursement",
        amount: -5_000_000,
        contractId: a,
      });
      const paid = await seedCash(db, shop, {
        date: "2026-10-01",
        type: "interest_payment",
        amount: 150_000,
        contractId: a,
      });
      await seedCash(db, shop, {
        date: "2026-10-02",
        type: "principal_repayment",
        amount: 1_000_000,
        contractId: b,
      });
      await seedCash(db, shop, {
        date: "2026-10-03",
        type: "reversal",
        amount: -150_000,
        contractId: a,
        reverses: paid,
      });
      await seedCash(db, shop, {
        date: "2026-10-04",
        type: "interest_payment",
        amount: 99_000,
        contractId: foreign,
      });
      const installment = await seedInstallment(db, shop, {
        startDate: "2026-10-01",
        paid: 200_000,
      });
      await seedCash(db, shop, {
        date: "2026-10-05",
        type: "installment_payment",
        amount: 200_000,
        installmentContractId: installment,
      });
      const foreignInstallment = await seedInstallment(db, shop, {
        customerId: other,
        startDate: "2026-10-01",
      });
      await seedCash(db, shop, {
        date: "2026-10-06",
        type: "installment_disbursement",
        amount: -4_000_000,
        installmentContractId: foreignInstallment,
      });

      const profile = new DrizzleCustomerProfile(db);
      const rows = await profile.recentTransactions(
        shop.shopId,
        shop.customerId,
        20,
      );
      expect(
        rows.map((t) => [
          t.type,
          t.contractCode === rows[1].contractCode,
          t.reversed,
        ]),
      ).toEqual([
        ["installment_payment", false, false],
        ["reversal", true, false],
        ["principal_repayment", false, false],
        ["interest_payment", true, true],
        ["disbursement", true, false],
      ]);
      expect(rows[0].contractCode).toMatch(/^TG-/);
      expect(rows[3]).toMatchObject({
        periodFrom: "2026-09-01",
        periodTo: "2026-09-11",
      });
      expect(rows[3].amount.toBigInt()).toBe(150_000n);
      expect(
        await profile.recentTransactions(shop.shopId, shop.customerId, 2),
      ).toHaveLength(2);
    }));

  it("cách ly cửa hàng: B không đọc được khách, hợp đồng (cả trả góp), giao dịch của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const contract = await seedContract(db, a, {
        outstanding: 1_000_000,
        paidUntil: "2026-10-01",
      });
      await seedCash(db, a, {
        date: "2026-10-01",
        type: "interest_payment",
        amount: 100_000,
        contractId: contract,
      });
      const installment = await seedInstallment(db, a, {
        startDate: "2026-10-01",
      });
      await seedCash(db, a, {
        date: "2026-10-01",
        type: "installment_disbursement",
        amount: -4_000_000,
        installmentContractId: installment,
      });
      const b = await seedShop(db);
      const profile = new DrizzleCustomerProfile(db);
      expect(
        await profile.findCustomer(b.shopId, a.customerId, TODAY),
      ).toBeNull();
      expect(
        await profile.listContracts(b.shopId, a.customerId, TODAY),
      ).toEqual([]);
      expect(
        await profile.recentTransactions(b.shopId, a.customerId, 20),
      ).toEqual([]);
      expect(
        await profile.findCustomer(a.shopId, a.customerId, TODAY),
      ).not.toBeNull();
    }));
});
