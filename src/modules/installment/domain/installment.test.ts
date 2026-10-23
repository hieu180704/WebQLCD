import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import {
  annualPercent,
  checkTerms,
  dueStatus,
  dueThrough,
  paidPeriods,
  paymentOptions,
  periodCount,
  periodsCovered,
  periodDueDate,
  planPayment,
  planSettlement,
  progress,
  rateWarning,
  schedulePeriods,
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

describe("đóng tiền góp", () => {
  const paid = (n: number) => ({ ...TERMS, amountPaid: vnd(n) });

  it("lựa chọn góp đến hết kỳ k: số tiền = luỹ kế − đã thu", () => {
    const options = paymentOptions(paid(1_650_000));
    expect(options[0]).toMatchObject({ index: 9, due: "2026-10-19" });
    expect(options.map((o) => o.amount.toBigInt()).slice(0, 3)).toEqual([150_000n, 350_000n, 550_000n]);
    expect(options).toHaveLength(17);
    expect(paymentOptions(paid(5_000_000))).toEqual([]);
  });

  it("số tiền tự do trong khoảng (0, còn phải thu]; thu đủ thì đóng hợp đồng", () => {
    expect(planPayment(paid(0), Money.ZERO)).toEqual({ ok: false, error: "amount_not_positive" });
    expect(planPayment(paid(4_900_000), vnd(100_001))).toEqual({ ok: false, error: "amount_exceeds_remaining" });
    const partial = planPayment(paid(0), vnd(250_000));
    expect(partial.ok && partial.value.closes).toBe(false);
    const last = planPayment(paid(4_900_000), vnd(100_000));
    expect(last.ok && last.value.closes).toBe(true);
  });

  it("tất toán: mặc định thu đủ, được giảm kể cả về 0, không thu quá", () => {
    const full = planSettlement(paid(1_600_000), null);
    expect(full.ok && full.value.amount.toBigInt()).toBe(3_400_000n);
    const discounted = planSettlement(paid(1_600_000), Money.ZERO);
    expect(discounted.ok && discounted.value).toMatchObject({ closes: true });
    expect(planSettlement(paid(1_600_000), vnd(3_400_001))).toEqual({ ok: false, error: "amount_exceeds_remaining" });
    expect(planSettlement(paid(1_600_000), vnd(-1))).toEqual({ ok: false, error: "amount_negative" });
  });

  it("nhãn kỳ của một lần thu", () => {
    expect(periodsCovered(TERMS, vnd(1_200_000), vnd(1_600_000))).toEqual({ first: 7, last: 8 });
    expect(periodsCovered(TERMS, vnd(1_600_000), vnd(1_650_000))).toEqual({ first: 9, last: 9 });
    expect(periodsCovered(TERMS, vnd(1_650_000), vnd(1_800_000))).toEqual({ first: 9, last: 9 });
    expect(periodsCovered(TERMS, vnd(4_900_000), vnd(5_000_000))).toEqual({ first: 25, last: 25 });
  });

  it("lịch góp: phần đã góp từng kỳ, ngày góp đủ theo lần thu", () => {
    const payments = [
      { on: "2026-10-03", amount: vnd(150_000) },
      { on: "2026-10-05", amount: vnd(300_000) },
    ];
    const rows = schedulePeriods(paid(450_000), payments, 1, 4);
    expect(rows.map((r) => [r.index, r.due, r.paid.toBigInt(), r.paidOn])).toEqual([
      [1, "2026-10-03", 200_000n, "2026-10-05"],
      [2, "2026-10-05", 200_000n, "2026-10-05"],
      [3, "2026-10-07", 50_000n, null],
      [4, "2026-10-09", 0n, null],
    ]);
    expect(schedulePeriods(paid(450_000), payments, 2, 2).map((r) => r.paidOn)).toEqual(["2026-10-05"]);
  });
});
