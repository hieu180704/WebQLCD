// Hàm SQL contract_accrued_interest (migration 0009) phải ra đúng số như accruedInterest của domain:
// reporting dùng hàm SQL để cộng lãi đến hôm nay của mọi hợp đồng mà không tải từng dòng về JS.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { accruedInterest, type InterestStanding } from "../domain/contract";
import {
  RATE_SCALE,
  type InterestType,
} from "../domain/interest/interest-policy";

const url = process.env.DATABASE_URL;

const TYPES: InterestType[] = [
  "per_million_per_day",
  "percent_per_month",
  "percent_per_week",
];
const TODAY: LocalDate = "2026-10-23";

/** rate đã nhân RATE_SCALE → chuỗi numeric(9,4). */
const rateText = (rate: bigint) =>
  `${rate / RATE_SCALE}.${(rate % RATE_SCALE).toString().padStart(4, "0")}`;

// Sinh số giả ngẫu nhiên có hạt giống để lần chạy nào cũng cùng bộ ca.
function rng(seed: number) {
  return (max: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % max;
  };
}

describe.skipIf(!url)("contract_accrued_interest", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function sqlInterest(
    c: InterestStanding,
    today: LocalDate,
  ): Promise<bigint> {
    const db = drizzle({ client: pool });
    const { rows } = await db.execute<{ v: string }>(
      sql`SELECT contract_accrued_interest(${c.interestType}::interest_type, ${c.outstandingPrincipal.toString()}::bigint, ${rateText(c.interestRate)}::numeric, ${c.interestPaidUntil}::date, ${today}::date) AS v`,
    );
    return BigInt(rows[0].v);
  }

  it("khớp domain trên các ca biên: chưa tới ngày, lãi 0, đúng nửa đồng, số lớn", async () => {
    const cases: InterestStanding[] = [
      // Ngày đã trả đến sau hôm nay (thu lãi trước) và đúng hôm nay: lãi 0.
      {
        interestType: "percent_per_month",
        interestRate: 30_000n,
        interestPeriodDays: 30,
        outstandingPrincipal: Money.of(10_000_000n),
        interestPaidUntil: addDays(TODAY, 5),
      },
      {
        interestType: "percent_per_month",
        interestRate: 30_000n,
        interestPeriodDays: 30,
        outstandingPrincipal: Money.of(10_000_000n),
        interestPaidUntil: TODAY,
      },
      {
        interestType: "per_million_per_day",
        interestRate: 0n,
        interestPeriodDays: 10,
        outstandingPrincipal: Money.of(5_000_000n),
        interestPaidUntil: addDays(TODAY, -40),
      },
      // 1.500 × 1 %/tháng × 1 ngày / 30 = 0,5 đồng → 1; 2.500 × 1 × 1 / 30 ≈ 0,83 → 1; 1.499 → 0,4997 → 0.
      {
        interestType: "percent_per_month",
        interestRate: 10_000n,
        interestPeriodDays: 30,
        outstandingPrincipal: Money.of(1_500n),
        interestPaidUntil: addDays(TODAY, -1),
      },
      {
        interestType: "percent_per_month",
        interestRate: 10_000n,
        interestPeriodDays: 30,
        outstandingPrincipal: Money.of(1_499n),
        interestPaidUntil: addDays(TODAY, -1),
      },
      // 350 × 1 %/tuần × 1 ngày / 7 = 0,5 đồng → 1.
      {
        interestType: "percent_per_week",
        interestRate: 10_000n,
        interestPeriodDays: 7,
        outstandingPrincipal: Money.of(350n),
        interestPaidUntil: addDays(TODAY, -1),
      },
      // Gốc 100 tỷ, lãi lẻ 4 chữ số, 10 năm.
      {
        interestType: "per_million_per_day",
        interestRate: 99_999_999n,
        interestPeriodDays: 30,
        outstandingPrincipal: Money.of(100_000_000_000n),
        interestPaidUntil: addDays(TODAY, -3650),
      },
    ];
    for (const c of cases) {
      expect(
        await sqlInterest(c, TODAY),
        JSON.stringify({
          ...c,
          interestRate: c.interestRate.toString(),
          outstandingPrincipal: c.outstandingPrincipal.toString(),
        }),
      ).toBe(accruedInterest(c, TODAY).toBigInt());
    }
  });

  it("khớp domain trên 300 ca ngẫu nhiên của cả 3 hình thức lãi", async () => {
    const next = rng(20261023);
    for (let i = 0; i < 300; i++) {
      const c: InterestStanding = {
        interestType: TYPES[i % 3],
        interestRate: BigInt(next(200_000)), // 0 – 19,9999
        interestPeriodDays: 30,
        outstandingPrincipal: Money.of(BigInt(next(2_000_000_000))),
        interestPaidUntil: addDays(TODAY, 30 - next(400)),
      };
      expect(await sqlInterest(c, TODAY)).toBe(
        accruedInterest(c, TODAY).toBigInt(),
      );
    }
  });
});
