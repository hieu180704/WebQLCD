// Phần hợp đồng của báo cáo trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import { inRollbackTx, seedContract, seedInstallment, seedShop } from "./db-test-kit";
import { DrizzleContractReport } from "./drizzle-contract-report";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-22";
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

describe.skipIf(!url)("DrizzleContractReport", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const inTx = (fn: (db: Db) => Promise<void>) => inRollbackTx(pool, fn);

  /** seedContract cố định ngày vay và đặt ngày đóng/xoá = now(); test cần mốc cụ thể nên ghi đè. */
  const setDates = (db: Db, id: string, d: { loan?: string; closedAt?: string; deletedAt?: string }) =>
    db.execute(sql`UPDATE contracts SET loan_date = coalesce(${d.loan ?? null}::date, loan_date),
      closed_at = coalesce(${d.closedAt ?? null}::timestamptz, closed_at), deleted_at = coalesce(${d.deletedAt ?? null}::timestamptz, deleted_at)
      WHERE id = ${id}`);

  it("dư nợ hôm nay: gốc tách cầm đồ / tín chấp, trả góp còn phải thu, lãi chưa thu, quá hạn / chậm góp; chỉ hợp đồng đang mở chưa xoá", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedContract(db, shop, { outstanding: 5_000_000, paidUntil: "2026-10-11" }); // hạn 21/10: quá hạn
      await seedContract(db, shop, { kind: "unsecured", outstanding: 2_000_000, paidUntil: "2026-10-21", prepaid: true }); // quá hạn
      await seedContract(db, shop, { kind: "unsecured", outstanding: 1_000_000, paidUntil: "2026-10-20", period: 30 }); // chưa tới hạn
      await seedContract(db, shop, { outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await seedContract(db, shop, { outstanding: 7_000_000, paidUntil: "2026-09-01", deleted: true });
      // Trả góp: chậm góp (bắt đầu 10/10, chưa góp), đúng hạn (bắt đầu 20/10, góp 400.000), đã đóng, đã xoá.
      await seedInstallment(db, shop, { startDate: "2026-10-10" });
      await seedInstallment(db, shop, { startDate: "2026-10-20", paid: 400_000 });
      await seedInstallment(db, shop, { startDate: "2026-10-01", paid: 4_000_000, closed: true });
      await seedInstallment(db, shop, { startDate: "2026-10-10", deleted: true });

      const report = await new DrizzleContractReport(db).load(shop.shopId, TODAY, OCTOBER);
      expect(report.installmentRemaining.toBigInt()).toBe(9_600_000n);
      expect(report.installmentLate).toBe(1);
      expect(report.securedLending.toBigInt()).toBe(5_000_000n);
      expect(report.unsecuredLending.toBigInt()).toBe(3_000_000n);
      // 3 %/tháng: 5tr × 11 ngày = 55.000; 2tr × 1 ngày = 2.000; 1tr × 2 ngày = 2.000.
      expect(report.accruedInterest.toBigInt()).toBe(59_000n);
      expect(report.overdue).toBe(2);
    }));

  it("trong kỳ: mở mới theo ngày vay / ngày bắt đầu, đóng / xoá theo ngày giờ Việt Nam; hợp đồng đã xoá không tính mở mới, đóng; cả trả góp", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const report = new DrizzleContractReport(db);
      const opened = await seedContract(db, shop, { outstanding: 1_000_000, paidUntil: "2026-10-05" });
      await setDates(db, opened, { loan: "2026-10-05" });
      const openedBefore = await seedContract(db, shop, { outstanding: 1_000_000, paidUntil: "2026-09-30" });
      await setDates(db, openedBefore, { loan: "2026-09-30" });
      // 23:30 ngày 31/10 giờ Việt Nam = 16:30 UTC: trong kỳ; 00:30 ngày 01/11 giờ Việt Nam: ngoài kỳ.
      const closedLate = await seedContract(db, shop, { outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await setDates(db, closedLate, { closedAt: "2026-10-31T16:30:00Z" });
      const closedNext = await seedContract(db, shop, { outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await setDates(db, closedNext, { closedAt: "2026-10-31T17:30:00Z" });
      const closedThenDeleted = await seedContract(db, shop, { outstanding: 0, paidUntil: "2026-09-01", closed: true, deleted: true });
      await setDates(db, closedThenDeleted, { loan: "2026-10-02", closedAt: "2026-10-10T03:00:00Z", deletedAt: "2026-10-11T03:00:00Z" });
      const deletedEarly = await seedContract(db, shop, { outstanding: 1_000_000, paidUntil: "2026-09-01", deleted: true });
      await setDates(db, deletedEarly, { deletedAt: "2026-09-30T16:59:00Z" }); // 23:59 ngày 30/9 giờ Việt Nam

      expect(await report.load(shop.shopId, TODAY, OCTOBER)).toMatchObject({ opened: 1, closed: 1, deleted: 1 });
      expect(await report.load(shop.shopId, TODAY, { from: "2026-09-30", to: "2026-09-30" })).toMatchObject({
        opened: 1,
        closed: 0,
        deleted: 1,
      });

      // Trả góp: mở 05/10; mở 30/09 rồi tất toán 31/10 23:30 giờ Việt Nam; mở 02/10 rồi xoá 11/10 (không tính mở mới).
      await seedInstallment(db, shop, { startDate: "2026-10-05" });
      const settled = await seedInstallment(db, shop, { startDate: "2026-09-30", paid: 5_000_000, closed: true });
      await db.execute(sql`UPDATE installment_contracts SET closed_at = '2026-10-31T16:30:00Z' WHERE id = ${settled}`);
      const removed = await seedInstallment(db, shop, { startDate: "2026-10-02", deleted: true });
      await db.execute(sql`UPDATE installment_contracts SET deleted_at = '2026-10-11T03:00:00Z' WHERE id = ${removed}`);
      expect(await report.load(shop.shopId, TODAY, OCTOBER)).toMatchObject({ opened: 2, closed: 2, deleted: 2 });
      expect(await report.load(shop.shopId, TODAY, { from: "2026-09-30", to: "2026-09-30" })).toMatchObject({
        opened: 2,
        closed: 0,
        deleted: 1,
      });
    }));

  it("cách ly cửa hàng: B không thấy số liệu của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      await seedContract(db, a, { outstanding: 5_000_000, paidUntil: "2026-10-01" });
      await seedContract(db, a, { outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await seedInstallment(db, a, { startDate: "2026-10-10" });
      const b = await seedShop(db);
      const report = await new DrizzleContractReport(db).load(b.shopId, TODAY, OCTOBER);
      expect(report).toMatchObject({ overdue: 0, installmentLate: 0, opened: 0, closed: 0, deleted: 0 });
      expect(
        [report.securedLending, report.unsecuredLending, report.installmentRemaining, report.accruedInterest].every((m) => m.isZero()),
      ).toBe(true);
    }));
});
