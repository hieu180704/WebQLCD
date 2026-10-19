import { describe, expect, it } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  it("cộng trừ đúng trên số nguyên lớn", () => {
    const a = Money.of(9_007_199_254_740_993n); // vượt Number.MAX_SAFE_INTEGER
    expect(a.add(Money.of(2n)).toBigInt()).toBe(9_007_199_254_740_995n);
    expect(a.subtract(a).isZero()).toBe(true);
  });

  it("fromNumber từ chối số lẻ và số không an toàn", () => {
    expect(() => Money.fromNumber(1.5)).toThrow(RangeError);
    expect(() => Money.fromNumber(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(Money.fromNumber(500_000).toBigInt()).toBe(500_000n);
  });

  it("đổi dấu và so sánh", () => {
    const chi = Money.of(1_000_000n).negate();
    expect(chi.isNegative()).toBe(true);
    expect(chi.compare(Money.ZERO)).toBe(-1);
    expect(Money.of(5n).equals(Money.of(5n))).toBe(true);
  });
});
