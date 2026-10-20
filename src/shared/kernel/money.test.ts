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

  it("mulDiv làm tròn half-up về 1 đồng, đối xứng quanh 0", () => {
    expect(Money.of(10n).mulDiv(1n, 4n).toBigInt()).toBe(3n); // 2,5 → 3
    expect(Money.of(10n).mulDiv(1n, 3n).toBigInt()).toBe(3n); // 3,33 → 3
    expect(Money.of(10n).mulDiv(2n, 3n).toBigInt()).toBe(7n); // 6,67 → 7
    expect(Money.of(-10n).mulDiv(1n, 4n).toBigInt()).toBe(-3n);
    expect(Money.of(9_007_199_254_740_993n).mulDiv(3n, 1n).toBigInt()).toBe(27_021_597_764_222_979n);
    expect(() => Money.of(1n).mulDiv(1n, 0n)).toThrow(RangeError);
  });

  it("đổi dấu và so sánh", () => {
    const chi = Money.of(1_000_000n).negate();
    expect(chi.isNegative()).toBe(true);
    expect(chi.compare(Money.ZERO)).toBe(-1);
    expect(Money.of(5n).equals(Money.of(5n))).toBe(true);
  });
});
