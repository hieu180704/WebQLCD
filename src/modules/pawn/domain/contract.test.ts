import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { accruedInterest, nextInterestDue, planDisbursement, type ContractTerms } from "./contract";

const TODAY = "2026-10-20";
const terms = (overrides: Partial<ContractTerms> = {}): ContractTerms => ({
  kind: "secured",
  assetName: "Honda Vision",
  principal: Money.fromNumber(5_000_000),
  interestType: "per_million_per_day",
  interestRate: 30_000n, // 3k/triệu/ngày
  interestPeriodDays: 10,
  termDays: 30,
  loanDate: TODAY,
  prepaidInterest: false,
  ...overrides,
});

describe("planDisbursement", () => {
  it("không thu lãi trước: giao đủ gốc, lãi chưa trả", () => {
    const result = planDisbursement(terms(), TODAY);
    expect(result).toMatchObject({ ok: true, value: { prepaid: null, interestPaidUntil: TODAY } });
    if (result.ok) expect(result.value.cashToCustomer.toBigInt()).toBe(5_000_000n);
  });

  it("thu lãi trước: trừ lãi kỳ đầu, kỳ [ngày vay, ngày vay + kỳ)", () => {
    const result = planDisbursement(terms({ prepaidInterest: true }), TODAY);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.prepaid).toMatchObject({ from: TODAY, to: "2026-10-30" });
    expect(result.value.prepaid?.amount.toBigInt()).toBe(150_000n);
    expect(result.value.cashToCustomer.toBigInt()).toBe(4_850_000n);
    expect(result.value.principal.toBigInt()).toBe(5_000_000n);
    expect(result.value.interestPaidUntil).toBe("2026-10-30");
  });

  it("thu lãi trước với lãi suất 0: không có dòng lãi, ngày trả đến giữ bằng ngày vay", () => {
    const result = planDisbursement(terms({ prepaidInterest: true, interestRate: 0n }), TODAY);
    expect(result).toMatchObject({ ok: true, value: { prepaid: null, interestPaidUntil: TODAY } });
  });

  it("ngày vay lùi về quá khứ được, ngày tương lai thì không", () => {
    expect(planDisbursement(terms({ loanDate: "2026-10-01" }), TODAY).ok).toBe(true);
    expect(planDisbursement(terms({ loanDate: "2026-10-21" }), TODAY)).toEqual({ ok: false, error: "loan_date_in_future" });
  });

  it("vi phạm quy tắc", () => {
    expect(planDisbursement(terms({ assetName: "  " }), TODAY)).toEqual({ ok: false, error: "asset_required" });
    expect(planDisbursement(terms({ kind: "unsecured", assetName: null }), TODAY).ok).toBe(true);
    expect(planDisbursement(terms({ principal: Money.ZERO }), TODAY)).toEqual({ ok: false, error: "principal_not_positive" });
    expect(planDisbursement(terms({ interestPeriodDays: 31 }), TODAY)).toEqual({ ok: false, error: "period_exceeds_term" });
    // 1000k/triệu/ngày × 10 ngày = 10 lần gốc.
    expect(planDisbursement(terms({ prepaidInterest: true, interestRate: 10_000_000n }), TODAY)).toEqual({
      ok: false,
      error: "prepaid_not_less_than_principal",
    });
  });
});

describe("lãi đến hôm nay và hạn đóng lãi", () => {
  const standing = {
    interestType: "percent_per_month" as const,
    interestRate: 30_000n, // 3%/tháng
    interestPeriodDays: 30,
    outstandingPrincipal: Money.fromNumber(10_000_000),
    interestPaidUntil: "2026-10-10",
  };

  it("tính trên gốc còn lại từ ngày đã trả đến; chưa tới thì 0", () => {
    expect(accruedInterest(standing, TODAY).toBigInt()).toBe(100_000n);
    expect(accruedInterest({ ...standing, interestPaidUntil: "2026-10-30" }, TODAY).isZero()).toBe(true);
  });

  it("thu lãi sau: hạn = ngày trả đến + kỳ; thu lãi trước: hạn = ngày trả đến", () => {
    expect(nextInterestDue({ ...standing, prepaidInterest: false })).toBe("2026-11-09");
    expect(nextInterestDue({ ...standing, prepaidInterest: true })).toBe("2026-10-10");
  });
});
