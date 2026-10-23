import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import {
  annualPercent,
  checkTerms,
  dueStatus,
  dueThrough,
  paidPeriods,
  periodCount,
  periodDueDate,
  progress,
  rateWarning,
  type InstallmentTerms,
} from "./installment";

const vnd = (n: number) => Money.fromNumber(n);
// Ví dụ mockup: đưa 4tr, thu 5tr trong 50 ngày, 2 ngày một kỳ.
const TERMS: InstallmentTerms = {
  amountGiven: vnd(4_000_000),
  totalDue: vnd(5_000_000),
  totalDays: 50,
  periodDays: 2,
  startDate: "2026-10-01",
};

describe("lịch góp", () => {
  it("số kỳ làm tròn lên, kỳ cuối rơi đúng ngày kết thúc", () => {
    expect(periodCount(TERMS)).toBe(25);
    expect(periodCount({ totalDays: 10, periodDays: 3 })).toBe(4);
    expect(periodDueDate(TERMS, 1)).toBe("2026-10-03");
    expect(periodDueDate(TERMS, 25)).toBe("2026-11-20");
    const uneven = { ...TERMS, totalDays: 10, periodDays: 3 };
    expect([1, 2, 3, 4].map((k) => periodDueDate(uneven, k))).toEqual(["2026-10-04", "2026-10-07", "2026-10-10", "2026-10-11"]);
  });

  it("chia đều: luỹ kế làm tròn half-up, tổng các kỳ đúng bằng tổng phải thu", () => {
    expect(dueThrough(TERMS, 1).toBigInt()).toBe(200_000n);
    const odd = { ...TERMS, totalDue: vnd(1_000_000), totalDays: 3, periodDays: 1 };
    expect([1, 2, 3].map((k) => dueThrough(odd, k).toBigInt())).toEqual([333_333n, 666_667n, 1_000_000n]);
    expect(dueThrough(odd, 0).isZero()).toBe(true);
    expect(dueThrough(odd, 9).toBigInt()).toBe(1_000_000n);
  });

  it("kỳ đã góp đủ: góp thiếu, góp dư dồn sang kỳ sau", () => {
    expect(paidPeriods(TERMS, Money.ZERO)).toBe(0);
    expect(paidPeriods(TERMS, vnd(199_999))).toBe(0);
    expect(paidPeriods(TERMS, vnd(1_600_000))).toBe(8);
    expect(paidPeriods(TERMS, vnd(1_750_000))).toBe(8);
    expect(paidPeriods(TERMS, vnd(5_000_000))).toBe(25);
  });

  it("tiến độ: kỳ tới, số kỳ chậm, còn phải thu", () => {
    // 8 kỳ đã góp, hôm nay 19/10 là hạn kỳ 9.
    const p = progress({ ...TERMS, amountPaid: vnd(1_600_000) }, "2026-10-19");
    expect(p).toMatchObject({ periods: 25, paidPeriods: 8, lateCount: 0, next: { index: 9, due: "2026-10-19" } });
    expect(p.next?.remaining.toBigInt()).toBe(200_000n);
    expect(p.remaining.toBigInt()).toBe(3_400_000n);
    expect(dueStatus(p, "2026-10-19")).toEqual({ kind: "today" });

    // Qua ngày 19/10 chưa góp: chậm 1 kỳ; góp lẻ 50.000 vẫn chậm, kỳ tới còn thiếu 150.000.
    const late = progress({ ...TERMS, amountPaid: vnd(1_650_000) }, "2026-10-20");
    expect(late.lateCount).toBe(1);
    expect(late.next?.remaining.toBigInt()).toBe(150_000n);
    expect(dueStatus(late, "2026-10-20")).toEqual({ kind: "late", periods: 1 });

    expect(dueStatus(progress({ ...TERMS, amountPaid: vnd(2_000_000) }, "2026-10-20"), "2026-10-20")).toEqual({ kind: "on_time" });
    // Quá ngày kết thúc: mọi kỳ chưa góp đều chậm.
    expect(progress({ ...TERMS, amountPaid: Money.ZERO }, "2026-12-01").lateCount).toBe(25);
    // Góp đủ: không còn kỳ tới.
    expect(progress({ ...TERMS, amountPaid: vnd(5_000_000) }, "2026-10-20").next).toBeNull();
  });
});

describe("tạo hợp đồng", () => {
  it("kiểm quy tắc", () => {
    expect(checkTerms(TERMS, "2026-10-01")).toBeNull();
    expect(checkTerms({ ...TERMS, amountGiven: Money.ZERO }, "2026-10-01")).toBe("amount_not_positive");
    expect(checkTerms({ ...TERMS, totalDue: vnd(3_999_999) }, "2026-10-01")).toBe("total_less_than_given");
    expect(checkTerms({ ...TERMS, periodDays: 51 }, "2026-10-01")).toBe("period_exceeds_total");
    expect(checkTerms(TERMS, "2026-09-30")).toBe("start_date_in_future");
  });

  it("cảnh báo lãi quy đổi theo năm", () => {
    expect(annualPercent(TERMS)).toBe(182.5);
    expect(rateWarning(TERMS)).toBe("criminal_risk");
    // 10%/năm: không cảnh báo; đúng 20%: chưa vượt trần; trên 20%: vàng.
    expect(rateWarning({ amountGiven: vnd(3_650_000), totalDue: vnd(3_750_000), totalDays: 100 })).toBe("none");
    expect(rateWarning({ amountGiven: vnd(3_650_000), totalDue: vnd(3_850_000), totalDays: 100 })).toBe("none");
    expect(rateWarning({ amountGiven: vnd(3_650_000), totalDue: vnd(3_850_001), totalDays: 100 })).toBe("above_civil_cap");
    expect(rateWarning({ ...TERMS, totalDue: vnd(4_000_000) })).toBe("none");
  });
});
