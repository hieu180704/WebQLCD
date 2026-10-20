import { RATE_SCALE, interestPolicy, type InterestType } from "./interest-policy";

const RATE_PATTERN = /^\d{1,5}(?:[.,]\d{1,4})?$/;

/** "3", "1,5", "0.0833" → số nguyên đã nhân RATE_SCALE; sai định dạng hoặc quá numeric(9,4) thì null. */
export function parseRate(text: string): bigint | null {
  const value = text.trim();
  if (!RATE_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(/[.,]/);
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(4, "0"));
}

/** Ngược của parseRate, dạng cột numeric(9,4) ("3.0000" → "3", "1.5000" → "1.5"). */
export function formatRate(rate: bigint): string {
  const whole = rate / RATE_SCALE;
  const fraction = (rate % RATE_SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export type RateWarning = "none" | "above_civil_cap" | "criminal_risk";

const CIVIL_CAP_PERCENT = 20n; // Điều 468 Bộ luật Dân sự 2015
const CRIMINAL_PERCENT = 100n; // Điều 201 Bộ luật Hình sự

/** Mức cảnh báo theo lãi suất quy đổi %/năm: > 20 vàng, ≥ 100 đỏ. Không chặn lưu (core-spec mục 2). */
export function rateWarning(type: InterestType, rate: bigint): RateWarning {
  const { numerator, denominator } = interestPolicy(type).annualFactor;
  // So sánh rate × numerator / denominator với ngưỡng × RATE_SCALE, nhân chéo để giữ số nguyên.
  const annualScaledTimesDen = rate * numerator;
  if (annualScaledTimesDen >= CRIMINAL_PERCENT * RATE_SCALE * denominator) return "criminal_risk";
  if (annualScaledTimesDen > CIVIL_CAP_PERCENT * RATE_SCALE * denominator) return "above_civil_cap";
  return "none";
}

/** Lãi suất %/năm để hiển thị, làm tròn 2 chữ số thập phân. */
export function annualPercent(type: InterestType, rate: bigint): number {
  const { numerator, denominator } = interestPolicy(type).annualFactor;
  const hundredths = (rate * numerator * 100n * 2n + denominator * RATE_SCALE) / (denominator * RATE_SCALE * 2n);
  return Number(hundredths) / 100;
}
