import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { dueStatus, dueThrough, progress, type DueStatus, type Progress } from "../domain/installment";
import type { InstallmentFilter, InstallmentListRow, InstallmentRepository } from "./ports";

export type { DueStatus };

export const INSTALLMENT_PAGE_SIZE = 50;
export const EXPORT_BATCH_SIZE = 500;

export type InstallmentListItem = InstallmentListRow & {
  progress: Progress;
  /** Tiền kỳ đầu ("Mỗi kỳ"); các kỳ chênh nhau tối đa 1 đồng do làm tròn. */
  perPeriod: Money;
  /** Chỉ hợp đồng đang góp, chưa xoá. */
  dueStatus: DueStatus | null;
};

export type InstallmentListView = { items: InstallmentListItem[]; nextAfter: string | null; today: LocalDate };

export class ListInstallments {
  constructor(private readonly installments: InstallmentRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, filter: InstallmentFilter, after: string | null, now = new Date()): Promise<InstallmentListView> {
    const today = businessDate(now);
    const rows = await this.installments.list(shopId, filter, today, after, INSTALLMENT_PAGE_SIZE + 1);
    const hasMore = rows.length > INSTALLMENT_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, INSTALLMENT_PAGE_SIZE) : rows;
    return { items: page.map((row) => toItem(row, today)), nextAfter: hasMore ? page[page.length - 1].id : null, today };
  }

  /** Mọi hợp đồng khớp bộ lọc, từng lô theo keyset (xuất Excel); cùng một "hôm nay" cho cả file. */
  async *batches(shopId: string, filter: InstallmentFilter, now = new Date()): AsyncGenerator<InstallmentListItem[]> {
    const today = businessDate(now);
    let after: string | null = null;
    for (;;) {
      const rows = await this.installments.list(shopId, filter, today, after, EXPORT_BATCH_SIZE);
      if (rows.length > 0) yield rows.map((row) => toItem(row, today));
      if (rows.length < EXPORT_BATCH_SIZE) return;
      after = rows[rows.length - 1].id;
    }
  }
}

function toItem(row: InstallmentListRow, today: LocalDate): InstallmentListItem {
  const p = progress(row, today);
  return {
    ...row,
    progress: p,
    perPeriod: dueThrough(row, 1),
    dueStatus: row.status === "active" && !row.deleted ? dueStatus(p, today) : null,
  };
}
