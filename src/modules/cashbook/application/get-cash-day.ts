import { addDays, businessDate, diffDays, type LocalDate } from "@/shared/kernel/local-date";
import { isManualEntryType, summarizeDay, type CashDaySummary } from "../domain/cash-entry";
import { CASH_TYPE_GROUPS, type CashLineFilter } from "./cash-filter";
import type { CashLine, CashLineQuery, CashbookRepository } from "./ports";

export const CASH_PAGE_SIZE = 50;
export const EXPORT_BATCH_SIZE = 500;

/** `reversible`: phiếu thu khác / chi khác / nạp vốn chưa bị huỷ (giao dịch hợp đồng huỷ ở trang hợp đồng). */
export type CashDayLine = CashLine & { reversible: boolean };

export type CashDayView = {
  date: LocalDate;
  today: LocalDate;
  /** Ngày trước / sau để điều hướng; `nextDate` null khi đang xem hôm nay. */
  prevDate: LocalDate;
  nextDate: LocalDate | null;
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
  async execute(
    shopId: string,
    requested: LocalDate | null,
    after: string | null,
    filter: CashLineFilter = {},
    now = new Date(),
  ): Promise<CashDayView> {
    const today = businessDate(now);
    const date = resolveCashDate(requested, now);
    const [totals, rows, openingBalanceSet] = await Promise.all([
      this.cashbook.dayTotals(shopId, date),
      this.cashbook.listDay(shopId, date, toQuery(filter), after, CASH_PAGE_SIZE + 1),
      this.cashbook.hasOpeningBalance(shopId),
    ]);
    const hasMore = rows.length > CASH_PAGE_SIZE;
    const lines = hasMore ? rows.slice(0, CASH_PAGE_SIZE) : rows;
    return {
      date,
      today,
      prevDate: addDays(date, -1),
      nextDate: date === today ? null : addDays(date, 1),
      summary: summarizeDay(totals.opening, totals.income, totals.expense),
      lines: lines.map((line) => ({ ...line, reversible: isManualEntryType(line.type) && !line.reversed })),
      nextAfter: hasMore ? lines[lines.length - 1].id : null,
      openingBalanceSet,
    };
  }

  /** Mọi giao dịch ngày `date` (đã qua `resolveCashDate`) khớp bộ lọc, từng lô theo keyset (xuất Excel). */
  async *batches(shopId: string, date: LocalDate, filter: CashLineFilter = {}): AsyncGenerator<CashLine[]> {
    const query = toQuery(filter);
    let after: string | null = null;
    for (;;) {
      const rows = await this.cashbook.listDay(shopId, date, query, after, EXPORT_BATCH_SIZE);
      if (rows.length > 0) yield rows;
      if (rows.length < EXPORT_BATCH_SIZE) return;
      after = rows[rows.length - 1].id;
    }
  }
}

/** Ngày sổ quỹ được xem: mặc định hôm nay, ngày tương lai quy về hôm nay. */
export function resolveCashDate(requested: LocalDate | null, now = new Date()): LocalDate {
  const today = businessDate(now);
  return requested && diffDays(today, requested) <= 0 ? requested : today;
}

const toQuery = (filter: CashLineFilter): CashLineQuery => ({
  types: filter.group ? CASH_TYPE_GROUPS[filter.group].types : null,
  createdBy: filter.createdBy ?? null,
});
