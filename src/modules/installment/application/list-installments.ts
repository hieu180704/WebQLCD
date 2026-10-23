import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { dueStatus, dueThrough, progress, type DueStatus, type Progress } from "../domain/installment";
import type { InstallmentListRow, InstallmentRepository } from "./ports";

export type { DueStatus };

export const INSTALLMENT_PAGE_SIZE = 50;

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
  async execute(shopId: string, after: string | null, now = new Date()): Promise<InstallmentListView> {
    const today = businessDate(now);
    const rows = await this.installments.list(shopId, after, INSTALLMENT_PAGE_SIZE + 1);
    const hasMore = rows.length > INSTALLMENT_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, INSTALLMENT_PAGE_SIZE) : rows;
    const items = page.map((row) => {
      const p = progress(row, today);
      return {
        ...row,
        progress: p,
        perPeriod: dueThrough(row, 1),
        dueStatus: row.status === "active" && !row.deleted ? dueStatus(p, today) : null,
      };
    });
    return { items, nextAfter: hasMore ? page[page.length - 1].id : null, today };
  }
}
