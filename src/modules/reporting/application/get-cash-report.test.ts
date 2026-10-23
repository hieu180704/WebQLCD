// Use case báo cáo thu chi với nguồn số liệu giả.
import { describe, expect, it } from "vitest";
import { addDays } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import {
  GetCashReport,
  REPORT_DAY_PAGE_SIZE,
  reportPresets,
  type CashDayRaw,
  type CashReportSource,
  type CashTypeTotal,
  type ReportRange,
} from "./get-cash-report";

const m = (n: number) => Money.fromNumber(n);
// 2026-10-23 08:00 giờ Việt Nam.
const NOW = new Date("2026-10-23T01:00:00Z");

function fakeSource(data: { before?: number; byType?: CashTypeTotal[]; days?: CashDayRaw[]; openedAt?: string } = {}) {
  const calls: { totals: ReportRange[]; days: [ReportRange, string | null, number][] } = { totals: [], days: [] };
  const source: CashReportSource = {
    openedAt: async () => data.openedAt ?? "2026-09-15",
    totals: async (_shop, range) => {
      calls.totals.push(range);
      return { before: m(data.before ?? 0), byType: data.byType ?? [] };
    },
    days: async (_shop, range, before, limit) => {
      calls.days.push([range, before, limit]);
      return data.days ?? [];
    },
  };
  return { source, calls };
}

describe("reportPresets", () => {
  it("hôm nay, tháng này, tháng trước (sang năm cũ với tháng 1), từ ngày mở két", () => {
    expect(reportPresets("2027-01-05", "2026-09-15").map((p) => [p.key, p.range])).toEqual([
      ["hom-nay", { from: "2027-01-05", to: "2027-01-05" }],
      ["thang-nay", { from: "2027-01-01", to: "2027-01-05" }],
      ["thang-truoc", { from: "2026-12-01", to: "2026-12-31" }],
      ["tu-dau", { from: "2026-09-15", to: "2027-01-05" }],
    ]);
  });

  it("ngày mở két sau hôm nay: kỳ từ ngày mở két chỉ còn hôm nay", () => {
    expect(reportPresets("2026-10-23", "2026-10-30")[3].range).toEqual({ from: "2026-10-23", to: "2026-10-23" });
  });
});

describe("GetCashReport", () => {
  it("mặc định tháng này theo giờ Việt Nam; đến ngày tương lai quy về hôm nay; thiếu từ ngày thì lấy đầu tháng của đến ngày", async () => {
    const { source, calls } = fakeSource();
    const report = new GetCashReport(source);
    expect((await report.execute("s", { from: null, to: null, before: null }, NOW)).range).toEqual({
      from: "2026-10-01",
      to: "2026-10-23",
    });
    expect((await report.execute("s", { from: "2026-10-10", to: "2026-12-01", before: null }, NOW)).range).toEqual({
      from: "2026-10-10",
      to: "2026-10-23",
    });
    expect((await report.execute("s", { from: null, to: "2026-09-20", before: null }, NOW)).range).toEqual({
      from: "2026-09-01",
      to: "2026-09-20",
    });
    expect(calls.days[0]).toEqual([{ from: "2026-10-01", to: "2026-10-23" }, null, REPORT_DAY_PAGE_SIZE + 1]);
  });

  it("từ ngày sau đến ngày: không truy vấn, report null", async () => {
    const { source, calls } = fakeSource();
    const view = await new GetCashReport(source).execute("s", { from: "2026-10-20", to: "2026-10-10", before: null }, NOW);
    expect(view.report).toBeNull();
    expect(calls.totals).toEqual([]);
  });

  it("đầu kỳ = trước kỳ + quỹ đầu két trong kỳ; thu chi không tính quỹ đầu két; đầu + thu + chi = cuối", async () => {
    const { source } = fakeSource({
      before: 1_000_000,
      byType: [
        { type: "opening_balance", count: 1, income: m(5_000_000), expense: Money.ZERO },
        { type: "interest_payment", count: 2, income: m(300_000), expense: Money.ZERO },
        { type: "disbursement", count: 1, income: Money.ZERO, expense: m(-2_000_000) },
        { type: "reversal", count: 2, income: m(2_000_000), expense: m(-100_000) },
      ],
    });
    const { report } = await new GetCashReport(source).execute("s", { from: null, to: null, before: null }, NOW);
    expect(report!.opening.toBigInt()).toBe(6_000_000n);
    expect(report!.income.toBigInt()).toBe(2_300_000n);
    expect(report!.expense.toBigInt()).toBe(-2_100_000n);
    expect(report!.closing.toBigInt()).toBe(6_200_000n);
    expect(report!.byType.map((row) => row.type)).toEqual(["interest_payment", "disbursement", "reversal"]);
  });

  it("theo ngày: cuối ngày = trước kỳ + cộng dồn, đầu ngày = cuối − thu − chi; thừa một dòng thì có trang sau", async () => {
    const days = Array.from({ length: REPORT_DAY_PAGE_SIZE + 1 }, (_, i) => ({
      date: addDays("2026-09-01", REPORT_DAY_PAGE_SIZE + 1 - i),
      income: m(100),
      expense: m(-40),
      running: m(60 * (REPORT_DAY_PAGE_SIZE + 1 - i)),
    }));
    const { source } = fakeSource({ before: 1_000, days });
    const { report } = await new GetCashReport(source).execute("s", { from: "2026-09-01", to: null, before: null }, NOW);
    expect(report!.days).toHaveLength(REPORT_DAY_PAGE_SIZE);
    const [newest] = report!.days;
    expect([newest.opening, newest.income, newest.expense, newest.closing].map((x) => x.toBigInt())).toEqual([2_860n, 100n, -40n, 2_920n]);
    expect(report!.nextBefore).toBe(days[REPORT_DAY_PAGE_SIZE - 1].date);
  });

  it("ngày xem tiếp phải sau từ ngày, không thì bỏ qua", async () => {
    const { source, calls } = fakeSource();
    const report = new GetCashReport(source);
    await report.execute("s", { from: "2026-10-05", to: null, before: "2026-10-05" }, NOW);
    await report.execute("s", { from: "2026-10-05", to: null, before: "2026-10-06" }, NOW);
    expect(calls.days.map(([, before]) => before)).toEqual([null, "2026-10-06"]);
  });
});
