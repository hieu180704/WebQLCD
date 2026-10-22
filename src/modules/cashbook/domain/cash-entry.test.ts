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

  it("phiếu không gắn hợp đồng: chi khác là chi, thu khác và nạp vốn là thu", () => {
    expect(signedAmount({ type: "manual_expense", amount: vnd(1_250_000) }).toBigInt()).toBe(-1_250_000n);
    expect(signedAmount({ type: "manual_income", amount: vnd(2_500_000) }).toBigInt()).toBe(2_500_000n);
    expect(signedAmount({ type: "capital_in", amount: vnd(50_000_000) }).toBigInt()).toBe(50_000_000n);
  });

  it("độ lớn 0 hoặc âm là lỗi lập trình", () => {
    expect(() => signedAmount({ type: "opening_balance", amount: Money.ZERO })).toThrow(RangeError);
    expect(() => signedAmount({ type: "disbursement", contractId: "c", amount: vnd(-1) })).toThrow(RangeError);
  });

  it("bút toán đảo ghi số đối của dòng gốc (dòng gốc có dấu)", () => {
    expect(signedAmount({ type: "reversal", reversesId: "t", contractId: "c", amount: vnd(-5_000_000) }).toBigInt()).toBe(5_000_000n);
    expect(signedAmount({ type: "reversal", reversesId: "t", contractId: "c", amount: vnd(150_000) }).toBigInt()).toBe(-150_000n);
    expect(() => signedAmount({ type: "reversal", reversesId: "t", contractId: null, amount: Money.ZERO })).toThrow(RangeError);
  });

  it("cuối ngày = đầu ngày − chi + thu", () => {
    expect(summarizeDay(vnd(20_000_000), vnd(150_000), vnd(-5_000_000)).closing.toBigInt()).toBe(15_150_000n);
  });
});
