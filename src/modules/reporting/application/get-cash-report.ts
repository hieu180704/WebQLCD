import { addDays, businessDate, diffDays, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";

/** Loại giao dịch két (enum `cash_transaction_type`, data-model mục 3.6). */
export type CashType =
  | "opening_balance"
  | "capital_in"
  | "manual_income"
  | "manual_expense"
  | "disbursement"
  | "additional_loan"
  | "interest_payment"
  | "principal_repayment"
  | "installment_disbursement"
  | "installment_payment"
  | "reversal";

/** Kỳ báo cáo, tính cả hai đầu, theo ngày nghiệp vụ. */
export type ReportRange = { from: LocalDate; to: LocalDate };

/** Số liệu một loại trong kỳ. `income` dương, `expense` âm; dòng đảo chia theo dấu như sổ quỹ. */
export type CashTypeTotal = { type: CashType; count: number; income: Money; expense: Money };

/** Một ngày có phát sinh trong kỳ; `running` = Σ amount từ đầu kỳ tới hết ngày này. */
export type CashDayRaw = { date: LocalDate; income: Money; expense: Money; running: Money };

export type CashDayRow = { date: LocalDate; opening: Money; income: Money; expense: Money; closing: Money };

export interface CashReportSource {
  /** Ngày mở két của cửa hàng. */
  openedAt(shopId: string): Promise<LocalDate>;
  /** Σ amount trước kỳ + tổng theo loại trong kỳ (cả `opening_balance`). Mọi truy vấn lọc theo `shopId` của phiên. */
  totals(shopId: string, range: ReportRange): Promise<{ before: Money; byType: CashTypeTotal[] }>;
  /** Ngày có phát sinh trong kỳ, mới nhất trước, chỉ ngày trước `before` (nếu có), tối đa `limit` dòng. */
  days(shopId: string, range: ReportRange, before: LocalDate | null, limit: number): Promise<CashDayRaw[]>;
}

export const REPORT_DAY_PAGE_SIZE = 31;

export type ReportPreset = { key: "hom-nay" | "thang-nay" | "thang-truoc" | "tu-dau"; label: string; range: ReportRange };

/** Nút chọn nhanh kỳ (mockup bao-cao.html). */
export function reportPresets(today: LocalDate, openedAt: LocalDate): ReportPreset[] {
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthEnd = addDays(monthStart, -1);
  return [
    { key: "hom-nay", label: "Hôm nay", range: { from: today, to: today } },
    { key: "thang-nay", label: "Tháng này", range: { from: monthStart, to: today } },
    { key: "thang-truoc", label: "Tháng trước", range: { from: `${prevMonthEnd.slice(0, 7)}-01`, to: prevMonthEnd } },
    // Mở két sau hôm nay (đăng ký rồi chưa tới ngày mở) thì kỳ chỉ còn hôm nay.
    { key: "tu-dau", label: "Từ ngày mở két", range: { from: diffDays(openedAt, today) >= 0 ? openedAt : today, to: today } },
  ];
}

export type CashReport = {
  /** Quỹ đầu kỳ: như quỹ đầu ngày ở sổ quỹ, quỹ đầu két ghi trong kỳ tính vào đây, không tính vào thu. */
  opening: Money;
  income: Money;
  expense: Money;
  closing: Money;
  /** Không có `opening_balance` (đã nằm trong quỹ đầu kỳ). */
  byType: CashTypeTotal[];
  days: CashDayRow[];
  /** Ngày để xem trang sau của bảng theo ngày; null nếu hết. */
  nextBefore: LocalDate | null;
};

export type CashReportView = {
  today: LocalDate;
  range: ReportRange;
  presets: ReportPreset[];
  /** null khi từ ngày sau đến ngày. */
  report: CashReport | null;
};

export type CashReportQuery = { from: LocalDate | null; to: LocalDate | null; before: LocalDate | null };

/**
 * Báo cáo thu chi theo kỳ, cùng quy tắc với sổ quỹ (`/quy-ket`): thu/chi theo dấu từng dòng kể cả dòng đảo,
 * nên số mỗi ngày khớp sổ quỹ ngày đó. Mặc định tháng này; đến ngày sau hôm nay quy về hôm nay.
 */
export class GetCashReport {
  constructor(private readonly source: CashReportSource) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, query: CashReportQuery, now = new Date()): Promise<CashReportView> {
    const today = businessDate(now);
    const presets = reportPresets(today, await this.source.openedAt(shopId));
    const to = query.to && diffDays(today, query.to) <= 0 ? query.to : today;
    const range = { from: query.from ?? `${to.slice(0, 7)}-01`, to };
    if (diffDays(range.from, range.to) < 0) return { today, range, presets, report: null };

    const before = query.before && diffDays(range.from, query.before) > 0 ? query.before : null;
    const [totals, raw] = await Promise.all([
      this.source.totals(shopId, range),
      this.source.days(shopId, range, before, REPORT_DAY_PAGE_SIZE + 1),
    ]);
    return { today, range, presets, report: buildReport(totals.before, totals.byType, raw) };
  }
}

function buildReport(before: Money, byType: CashTypeTotal[], raw: CashDayRaw[]): CashReport {
  const openingEntries = byType.find((row) => row.type === "opening_balance");
  const rest = byType.filter((row) => row.type !== "opening_balance");
  const income = rest.reduce((sum, row) => sum.add(row.income), Money.ZERO);
  const expense = rest.reduce((sum, row) => sum.add(row.expense), Money.ZERO);
  // Dòng đảo quỹ đầu két mang loại `reversal` nên nằm ở `rest`; `opening_balance` luôn dương.
  const opening = before.add(openingEntries?.income ?? Money.ZERO);

  const hasMore = raw.length > REPORT_DAY_PAGE_SIZE;
  const page = hasMore ? raw.slice(0, REPORT_DAY_PAGE_SIZE) : raw;
  const days = page.map((day) => {
    const closing = before.add(day.running);
    return {
      date: day.date,
      opening: closing.subtract(day.income).subtract(day.expense),
      income: day.income,
      expense: day.expense,
      closing,
    };
  });
  return {
    opening,
    income,
    expense,
    closing: opening.add(income).add(expense),
    byType: rest,
    days,
    nextBefore: hasMore ? page[page.length - 1].date : null,
  };
}
