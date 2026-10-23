// Hàm SQL installment_due_through / installment_late / installment_due_today (migration 0011) phải ra đúng như domain:
// danh sách lọc "Chậm góp", "Đến hạn hôm nay" và ô thống kê dùng hàm SQL, trang hiển thị nhãn dùng domain.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { dueStatus, dueThrough, periodCount, progress, type InstallmentStanding } from "../domain/installment";

const url = process.env.DATABASE_URL;
const START: LocalDate = "2026-10-01";

// Sinh số giả ngẫu nhiên có hạt giống để lần chạy nào cũng cùng bộ ca.
function rng(seed: number) {
  return (max: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % max;
  };
}

type Case = InstallmentStanding & { today: LocalDate };

describe.skipIf(!url)("installment_due_*", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function check(cases: Case[]) {
    const db = drizzle({ client: pool });
    for (const c of cases) {
      const args = sql`${c.totalDue.toBigInt()}::bigint, ${c.totalDays}::int, ${c.periodDays}::int`;
      const state = sql`${c.startDate}::date, ${c.amountPaid.toBigInt()}::bigint, ${c.today}::date`;
      const k = 1 + (c.totalDays % (periodCount(c) + 1));
      const { rows } = await db.execute<{ through: string; late: boolean; today: boolean }>(
        sql`SELECT installment_due_through(${args}, ${k}::int)::text AS through,
                   installment_late(${args}, ${state}) AS late, installment_due_today(${args}, ${state}) AS today`,
      );
      const p = progress(c, c.today);
      const status = dueStatus(p, c.today);
      expect(
        { through: rows[0].through, late: rows[0].late, today: rows[0].today },
        JSON.stringify({ ...c, totalDue: c.totalDue.toString(), amountPaid: c.amountPaid.toString(), k }),
      ).toEqual({ through: dueThrough(c, k).toString(), late: status.kind === "late", today: status.kind === "today" });
    }
  }

  const make = (totalDue: number, totalDays: number, periodDays: number, paid: number, dayOffset: number): Case => ({
    totalDue: Money.fromNumber(totalDue),
    totalDays,
    periodDays,
    startDate: START,
    amountPaid: Money.fromNumber(paid),
    today: addDays(START, dayOffset),
  });

  it("ca biên: trước ngày bắt đầu, đúng hạn từng kỳ, kỳ cuối ngắn, quá ngày kết thúc, góp lẻ, tổng nhỏ hơn số kỳ", () =>
    check([
      make(5_000_000, 50, 2, 0, -1),
      make(5_000_000, 50, 2, 0, 0),
      make(5_000_000, 50, 2, 0, 2),
      make(5_000_000, 50, 2, 0, 3),
      make(5_000_000, 50, 2, 200_000, 3),
      make(5_000_000, 50, 2, 1_650_000, 18),
      make(5_000_000, 50, 2, 1_600_000, 18),
      make(5_000_000, 50, 2, 4_800_000, 50),
      make(5_000_000, 50, 2, 4_800_000, 51),
      make(1_000_000, 10, 3, 0, 10),
      make(1_000_000, 10, 3, 750_000, 10),
      make(1_000_000, 10, 3, 750_000, 9),
      make(1_000_000, 3, 1, 333_333, 2),
      make(1_000_000, 3, 1, 333_332, 2),
      make(7, 30, 1, 0, 3),
      make(7, 30, 1, 0, 5),
      make(100_000_000_000, 3650, 1, 0, 3650),
    ]));

  it("300 ca ngẫu nhiên", () => {
    const next = rng(20_261_023);
    const cases: Case[] = [];
    for (let i = 0; i < 300; i++) {
      const totalDays = 1 + next(400);
      const periodDays = 1 + next(totalDays);
      const totalDue = 1 + next(50_000_000);
      const paid = next(3) === 0 ? 0 : next(totalDue + 1);
      cases.push(make(totalDue, totalDays, periodDays, paid, next(totalDays + 20) - 5));
    }
    return check(cases);
  });
});
