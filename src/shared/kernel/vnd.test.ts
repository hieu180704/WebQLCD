import { describe, expect, it } from "vitest";
import { Money } from "./money";
import { formatVnd, parseVnd } from "./vnd";

describe("VND", () => {
  it("định dạng dấu chấm phân cách nghìn", () => {
    expect(formatVnd(Money.of(5_000_000n))).toBe("5.000.000");
    expect(formatVnd(Money.of(-150_000n))).toBe("-150.000");
  });

  it("parse bỏ dấu phân cách, từ chối số âm, số lẻ, chữ", () => {
    expect(parseVnd("5.000.000")?.toBigInt()).toBe(5_000_000n);
    expect(parseVnd(" 5 000 000 ")?.toBigInt()).toBe(5_000_000n);
    expect(parseVnd("0")?.toBigInt()).toBe(0n);
    expect(parseVnd("5,000,000")?.toBigInt()).toBe(5_000_000n);
    for (const bad of ["", "-5000", "5e6", "abc", "1234567890123456", "1000000.5", "5.000,50", "5.00.000", "5.000 000"]) {
      expect(parseVnd(bad)).toBeNull();
    }
  });
});
