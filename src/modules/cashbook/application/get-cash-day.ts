import { businessDate, diffDays, type LocalDate } from "@/shared/kernel/local-date";
import { isManualEntryType, summarizeDay, type CashDaySummary } from "../domain/cash-entry";
import type { CashLine, CashbookRepository } from "./ports";

export const CASH_PAGE_SIZE = 50;

/** `reversible`: phiếu thu khác / chi khác / nạp vốn chưa bị huỷ (giao dịch hợp đồng huỷ ở trang hợp đồng). */
export type CashDayLine = CashLine & { reversible: boolean };

export type CashDayView = {
  date: LocalDate;
  today: LocalDate;
  summary: CashDaySummary;
  lines: CashDayLine[];
  /** Id để xem trang sau; null nếu hết. */
  nextAfter: string | null;
  openingBalanceSet: boolean;
};

/** Sổ quỹ một ngày: đầu ngày, thu, chi, cuối ngày + danh sách giao dịch. Ngày tương lai quy về hôm nay. */
export class GetCashDay {
  constructor(private readonly cashbook: CashbookRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, requested: LocalDate | null, after: string | null, now = new Date()): Promise<CashDayView> {
    const today = businessDate(now);
    const date = requested && diffDays(today, requested) <= 0 ? requested : today;
    const [totals, rows, openingBalanceSet] = await Promise.all([
      this.cashbook.dayTotals(shopId, date),
      this.cashbook.listDay(shopId, date, after, CASH_PAGE_SIZE + 1),
      this.cashbook.hasOpeningBalance(shopId),
    ]);
    const hasMore = rows.length > CASH_PAGE_SIZE;
    const lines = hasMore ? rows.slice(0, CASH_PAGE_SIZE) : rows;
    return {
      date,
      today,
      summary: summarizeDay(totals.opening, totals.income, totals.expense),
      lines: lines.map((line) => ({ ...line, reversible: isManualEntryType(line.type) && !line.reversed })),
      nextAfter: hasMore ? lines[lines.length - 1].id : null,
      openingBalanceSet,
    };
  }
}
