import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { signedAmount, summarizeDay } from "./cash-entry";

const vnd = (n: number) => Money.fromNumber(n);

describe("bút toán két", () => {
  it("áp dấu theo loại: giải ngân là chi, quỹ đầu két và thu lãi là thu", () => {
    expect(signedAmount({ type: "disbursement", contractId: "c", amount: vnd(5_000_000) }).toBigInt()).toBe(-5_000_000n);
    expect(signedAmount({ type: "opening_balance", amount: vnd(100) }).toBigInt()).toBe(100n);
    const interest = { type: "interest_payment", contractId: "c", amount: vnd(150_000), periodFrom: "2026-10-20", periodTo: "2026-10-30" } as const;
    expect(signedAmount(interest).toBigInt()).toBe(150_000n);
  });

  it("độ lớn 0 hoặc âm là lỗi lập trình", () => {
    expect(() => signedAmount({ type: "opening_balance", amount: Money.ZERO })).toThrow(RangeError);
    expect(() => signedAmount({ type: "disbursement", contractId: "c", amount: vnd(-1) })).toThrow(RangeError);
  });

  it("cuối ngày = đầu ngày − chi + thu", () => {
    expect(summarizeDay(vnd(20_000_000), vnd(150_000), vnd(-5_000_000)).closing.toBigInt()).toBe(15_150_000n);
  });
});
