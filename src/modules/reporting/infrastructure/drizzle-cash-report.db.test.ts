// Báo cáo thu chi trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import { inRollbackTx, seedCash as cash, seedContract, seedShop, type SeededShop } from "./db-test-kit";
import { DrizzleCashReport } from "./drizzle-cash-report";

const url = process.env.DATABASE_URL;
const RANGE = { from: "2026-10-03", to: "2026-10-06" };

describe.skipIf(!url)("DrizzleCashReport", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const inTx = (fn: (db: Db) => Promise<void>) => inRollbackTx(pool, fn);

  /** Quỹ đầu két 01/10, giao dịch trước kỳ, trong kỳ (có huỷ, có đảo quỹ đầu két) và sau kỳ. */
  async function seedLedger(db: Db, shop: SeededShop) {
    const id = await seedContract(db, shop, { outstanding: 2_000_000, paidUntil: "2026-10-02" });
    await cash(db, shop, { date: "2026-10-01", type: "opening_balance", amount: 10_000_000 });
    await cash(db, shop, { date: "2026-10-02", type: "disbursement", amount: -2_000_000, contractId: id });
    await cash(db, shop, { date: "2026-10-03", type: "interest_payment", amount: 60_000, contractId: id });
    const expense = await cash(db, shop, { date: "2026-10-03", type: "manual_expense", amount: -500_000 });
    await cash(db, shop, { date: "2026-10-05", type: "reversal", amount: 500_000, reverses: expense });
    const income = await cash(db, shop, { date: "2026-10-05", type: "manual_income", amount: 200_000 });
    await cash(db, shop, { date: "2026-10-05", type: "reversal", amount: -200_000, reverses: income });
    await cash(db, shop, { date: "2026-10-06", type: "capital_in", amount: 1_000_000 });
    await cash(db, shop, { date: "2026-10-07", type: "manual_income", amount: 999 });
  }

  it("tổng trước kỳ (cả quỹ đầu két), tổng theo loại trong kỳ chia thu/chi theo dấu, dòng đảo ở cả hai cột", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedLedger(db, shop);
      const { before, byType } = await new DrizzleCashReport(db).totals(shop.shopId, RANGE);
      expect(before.toBigInt()).toBe(8_000_000n);
      const rows = Object.fromEntries(byType.map((r) => [r.type, [r.count, r.income.toBigInt(), r.expense.toBigInt()]]));
      expect(rows).toEqual({
        interest_payment: [1, 60_000n, 0n],
        manual_expense: [1, 0n, -500_000n],
        manual_income: [1, 200_000n, 0n],
        reversal: [2, 500_000n, -200_000n],
        capital_in: [1, 1_000_000n, 0n],
      });
    }));

  it("quỹ đầu két ghi trong kỳ nằm ở loại riêng, không lẫn vào trước kỳ", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedLedger(db, shop);
      const { before, byType } = await new DrizzleCashReport(db).totals(shop.shopId, { from: "2026-10-01", to: "2026-10-01" });
      expect(before.isZero()).toBe(true);
      expect(byType.map((r) => [r.type, r.income.toBigInt()])).toEqual([["opening_balance", 10_000_000n]]);
    }));

  it("theo ngày: chỉ ngày có phát sinh, mới nhất trước, cộng dồn từ đầu kỳ; trang sau giữ số cộng dồn", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedLedger(db, shop);
      const report = new DrizzleCashReport(db);
      const days = await report.days(shop.shopId, RANGE, null, 10);
      expect(days.map((d) => [d.date, d.income.toBigInt(), d.expense.toBigInt(), d.running.toBigInt()])).toEqual([
        ["2026-10-06", 1_000_000n, 0n, 1_060_000n],
        ["2026-10-05", 700_000n, -200_000n, 60_000n],
        ["2026-10-03", 60_000n, -500_000n, -440_000n],
      ]);
      const page = await report.days(shop.shopId, RANGE, "2026-10-06", 1);
      expect(page.map((d) => [d.date, d.running.toBigInt()])).toEqual([["2026-10-05", 60_000n]]);
    }));

  it("theo ngày: thu không tính quỹ đầu két (như sổ quỹ)", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedLedger(db, shop);
      const [day] = await new DrizzleCashReport(db).days(shop.shopId, { from: "2026-10-01", to: "2026-10-01" }, null, 10);
      expect([day.income.toBigInt(), day.running.toBigInt()]).toEqual([0n, 10_000_000n]);
    }));

  it("ngày mở két của cửa hàng", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      expect(await new DrizzleCashReport(db).openedAt(shop.shopId)).toBe("2026-10-01");
    }));

  it("cách ly cửa hàng: B không thấy số liệu của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      await seedLedger(db, a);
      const b = await seedShop(db);
      const report = new DrizzleCashReport(db);
      const totals = await report.totals(b.shopId, RANGE);
      expect(totals.before.isZero()).toBe(true);
      expect(totals.byType).toEqual([]);
      expect(await report.days(b.shopId, RANGE, null, 10)).toEqual([]);
    }));
});
