import { Money } from "@/shared/kernel/money";

export type InterestType = "per_million_per_day" | "percent_per_month" | "percent_per_week";

/** Lãi suất lưu dạng số nguyên = lãi × RATE_SCALE (khớp cột numeric(9,4)). */
export const RATE_SCALE = 10_000n;

type Fraction = { numerator: bigint; denominator: bigint };

/**
 * Mỗi hình thức lãi một strategy (architecture-spec mục 2.3).
 * Lãi tính theo ngày trên gốc, làm tròn half-up về 1 đồng một lần cho cả khoảng (GIẢ ĐỊNH TẠM, core-spec mục 2).
 */
export interface InterestPolicy {
  readonly type: InterestType;
  /** Lãi của `days` ngày trên `principal`; `rate` đã nhân RATE_SCALE. */
  interestFor(principal: Money, rate: bigint, days: number): Money;
  /** Lãi suất %/năm = lãi × hệ số này (core-spec mục 2, cảnh báo lãi suất). */
  readonly annualFactor: Fraction;
}

abstract class DailyProratedPolicy implements InterestPolicy {
  abstract readonly type: InterestType;
  abstract readonly annualFactor: Fraction;
  /** Lãi = gốc × rate × ngày / divisor (rate đã nhân RATE_SCALE). */
  protected abstract readonly divisor: bigint;

  interestFor(principal: Money, rate: bigint, days: number): Money {
    if (!Number.isSafeInteger(days) || days < 0) throw new RangeError("Số ngày tính lãi phải là số nguyên không âm");
    if (rate < 0n) throw new RangeError("Lãi suất không được âm");
    return principal.mulDiv(rate * BigInt(days), this.divisor);
  }
}

/** k/triệu/ngày: gốc / 1.000.000 × lãi × 1.000 đồng × số ngày. */
export class PerMillionPerDayPolicy extends DailyProratedPolicy {
  readonly type = "per_million_per_day";
  readonly annualFactor = { numerator: 73n, denominator: 2n }; // × 36,5
  protected readonly divisor = 1_000n * RATE_SCALE;
}

/** %/tháng: gốc × lãi% × số ngày / 30. */
export class PercentPerMonthPolicy extends DailyProratedPolicy {
  readonly type = "percent_per_month";
  readonly annualFactor = { numerator: 365n, denominator: 30n };
  protected readonly divisor = 100n * 30n * RATE_SCALE;
}

/** %/tuần: gốc × lãi% × số ngày / 7. */
export class PercentPerWeekPolicy extends DailyProratedPolicy {
  readonly type = "percent_per_week";
  readonly annualFactor = { numerator: 365n, denominator: 7n };
  protected readonly divisor = 100n * 7n * RATE_SCALE;
}

const POLICIES: Record<InterestType, InterestPolicy> = {
  per_million_per_day: new PerMillionPerDayPolicy(),
  percent_per_month: new PercentPerMonthPolicy(),
  percent_per_week: new PercentPerWeekPolicy(),
};

export function interestPolicy(type: InterestType): InterestPolicy {
  return POLICIES[type];
}
