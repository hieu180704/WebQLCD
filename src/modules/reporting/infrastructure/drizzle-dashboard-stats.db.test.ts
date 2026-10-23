// Thống kê trang chủ trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import { inRollbackTx, seedCash as cash, seedContract, seedShop } from "./db-test-kit";
import { DrizzleDashboardStats } from "./drizzle-dashboard-stats";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-22";
const MONTH = { from: "2026-10-01", to: "2026-11-01" };

describe.skipIf(!url)("DrizzleDashboardStats", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const inTx = (fn: (db: Db) => Promise<void>) => inRollbackTx(pool, fn);

  const load = (db: Db, shopId: string) => new DrizzleDashboardStats(db).load(shopId, TODAY, MONTH);

  it("đang cho vay, đếm theo loại, quá hạn: chỉ hợp đồng đang mở chưa xoá; hạn theo thu lãi trước/sau; bỏ lãi suất 0", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedContract(db, shop, { outstanding: 5_000_000, paidUntil: "2026-10-11" }); // hạn 21/10: quá hạn
      await seedContract(db, shop, { outstanding: 3_000_000, paidUntil: "2026-10-12" }); // hạn 22/10: hôm nay, chưa quá
      await seedContract(db, shop, { kind: "unsecured", outstanding: 2_000_000, paidUntil: "2026-10-21", prepaid: true }); // hạn 21/10: quá hạn
      await seedContract(db, shop, { kind: "unsecured", outstanding: 1_000_000, paidUntil: "2026-09-01", rate: "0" }); // lãi suất 0
      await seedContract(db, shop, { outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await seedContract(db, shop, { outstanding: 7_000_000, paidUntil: "2026-09-01", deleted: true });

      const stats = await load(db, shop.shopId);
      expect(stats).toMatchObject({ openSecured: 2, openUnsecured: 2, overdue: 2 });
      expect(stats.lending.toBigInt()).toBe(11_000_000n);
      // 3 %/tháng: 5tr × 11 ngày = 55.000; 3tr × 10 ngày = 30.000; 2tr × 1 ngày = 2.000; lãi suất 0, đã đóng, đã xoá không tính.
      expect(stats.accruedInterest.toBigInt()).toBe(87_000n);
    }));

  it("lãi tháng này: dòng lãi + dòng đảo lãi ghi trong tháng; bỏ tháng khác, loại khác, đảo của dòng không phải lãi", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const id = await seedContract(db, shop, { outstanding: 5_000_000, paidUntil: "2026-10-11" });
      await cash(db, shop, { date: "2026-10-01", type: "interest_payment", amount: 100_000, contractId: id });
      const reversedInMonth = await cash(db, shop, { date: "2026-10-05", type: "interest_payment", amount: 40_000, contractId: id });
      await cash(db, shop, { date: "2026-10-06", type: "reversal", amount: -40_000, contractId: id, reverses: reversedInMonth });
      const lastMonth = await cash(db, shop, { date: "2026-09-30", type: "interest_payment", amount: 30_000, contractId: id });
      await cash(db, shop, { date: "2026-10-02", type: "reversal", amount: -30_000, contractId: id, reverses: lastMonth });
      await cash(db, shop, { date: "2026-11-01", type: "interest_payment", amount: 9_000, contractId: id });
      const repaid = await cash(db, shop, { date: "2026-10-03", type: "principal_repayment", amount: 500_000, contractId: id });
      await cash(db, shop, { date: "2026-10-04", type: "reversal", amount: -500_000, contractId: id, reverses: repaid });
      await cash(db, shop, { date: "2026-10-03", type: "manual_income", amount: 70_000 });

      // 100k + 40k − 40k − 30k (đảo trong tháng của dòng lãi tháng trước).
      expect((await load(db, shop.shopId)).interestThisMonth.toBigInt()).toBe(70_000n);
    }));

  it("cách ly cửa hàng: B không thấy số liệu của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const id = await seedContract(db, a, { outstanding: 5_000_000, paidUntil: "2026-10-01" });
      await cash(db, a, { date: TODAY, type: "interest_payment", amount: 100_000, contractId: id });
      const b = await seedShop(db);
      const stats = await load(db, b.shopId);
      expect(stats).toMatchObject({ openSecured: 0, openUnsecured: 0, overdue: 0 });
      expect(stats.lending.isZero()).toBe(true);
      expect(stats.interestThisMonth.isZero()).toBe(true);
      expect(stats.accruedInterest.isZero()).toBe(true);
    }));
});
