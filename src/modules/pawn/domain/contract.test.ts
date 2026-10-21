import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import {
  accruedInterest,
  interestOptions,
  nextInterestDue,
  planDisbursement,
  planInterestPayment,
  upcomingPeriods,
  type ContractTerms,
  type PayableStanding,
} from "./contract";

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

describe("đóng lãi", () => {
  // 5tr, 3k/triệu/ngày, kỳ 10 ngày: 150.000 đ mỗi kỳ.
  const standing = (overrides: Partial<PayableStanding> = {}): PayableStanding => ({
    interestType: "per_million_per_day",
    interestRate: 30_000n,
    interestPeriodDays: 10,
    outstandingPrincipal: Money.fromNumber(5_000_000),
    interestPaidUntil: "2026-10-01",
    prepaidInterest: false,
    ...overrides,
  });
  const summary = (periods: { from: string; to: string; amount: Money }[]) =>
    periods.map((p) => ({ from: p.from, to: p.to, amount: p.amount.toBigInt() }));

  it("lựa chọn: các kỳ đã tới hạn + một kỳ đóng sớm, lãi cộng dồn trên gốc còn lại", () => {
    // Thu lãi sau: kỳ 1 hạn 11/10, kỳ 2 hạn 21/10 (chưa tới hôm nay 20/10).
    expect(summary(interestOptions(standing(), TODAY))).toEqual([
      { from: "2026-10-01", to: "2026-10-11", amount: 150_000n },
      { from: "2026-10-01", to: "2026-10-21", amount: 300_000n },
    ]);
  });

  it("thu lãi trước: kỳ tới hạn ngay đầu kỳ", () => {
    // Kỳ 1 hạn 01/10, kỳ 2 hạn 11/10, kỳ 3 hạn 21/10.
    expect(interestOptions(standing({ prepaidInterest: true }), TODAY)).toHaveLength(3);
  });

  it("chưa tới hạn vẫn cho đóng sớm một kỳ; lãi suất 0 thì không có lựa chọn", () => {
    expect(interestOptions(standing({ interestPaidUntil: "2026-10-30" }), TODAY)).toHaveLength(1);
    expect(interestOptions(standing({ interestRate: 0n }), TODAY)).toEqual([]);
  });

  it("số kỳ ngoài lựa chọn, số tiền âm hoặc vượt lãi thì từ chối", () => {
    expect(planInterestPayment(standing(), TODAY, 3, null)).toEqual({ ok: false, error: "invalid_periods" });
    expect(planInterestPayment(standing(), TODAY, 0, null)).toEqual({ ok: false, error: "invalid_periods" });
    expect(planInterestPayment(standing(), TODAY, 1, Money.ZERO)).toEqual({ ok: false, error: "amount_not_positive" });
    expect(planInterestPayment(standing(), TODAY, 1, Money.fromNumber(150_001))).toEqual({ ok: false, error: "amount_exceeds_due" });
    expect(planInterestPayment(standing({ interestRate: 0n }), TODAY, 1, null)).toEqual({ ok: false, error: "no_interest_due" });
  });

  it("được giảm lãi: giữ kỳ, ghi số tiền khách đưa", () => {
    const result = planInterestPayment(standing(), TODAY, 2, Money.fromNumber(280_000));
    if (!result.ok) throw new Error(result.error);
    expect(summary([result.value])).toEqual([{ from: "2026-10-01", to: "2026-10-21", amount: 280_000n }]);
  });

  it("lịch kỳ chưa đóng: tới hết hạn vay; quá hạn vay thì tới hôm nay", () => {
    const schedule = upcomingPeriods(standing(), "2026-10-31", TODAY);
    expect(schedule.map((p) => [p.from, p.due])).toEqual([
      ["2026-10-01", "2026-10-11"],
      ["2026-10-11", "2026-10-21"],
      ["2026-10-21", "2026-10-31"],
    ]);
    expect(schedule[0].amount.toBigInt()).toBe(150_000n);
    expect(upcomingPeriods(standing({ interestPaidUntil: "2026-09-01" }), "2026-09-11", TODAY)).toHaveLength(5);
    expect(upcomingPeriods(standing({ interestPaidUntil: "2026-11-01" }), "2026-10-31", TODAY)).toHaveLength(1);
  });
});
