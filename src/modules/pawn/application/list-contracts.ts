import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { accruedInterest, nextInterestDue } from "../domain/contract";
import { formatRate } from "../domain/interest/rate";
import type { ContractFilter, ContractListRow, ContractRepository } from "./ports";

export const CONTRACT_PAGE_SIZE = 50;
export const EXPORT_BATCH_SIZE = 500;

export type ContractListItem = ContractListRow & {
  /** Lãi suất dạng chuỗi ("3", "1.5") để hiển thị. */
  rateText: string;
  /** Lãi phát sinh tới hôm nay trên gốc còn lại (chỉ hợp đồng đang mở). */
  accruedInterest: Money | null;
  nextInterestDue: LocalDate | null;
};

export type ContractListView = { items: ContractListItem[]; nextAfter: string | null; today: LocalDate };

export class ListContracts {
  constructor(private readonly contracts: ContractRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, filter: ContractFilter, after: string | null, now = new Date()): Promise<ContractListView> {
    const today = businessDate(now);
    const rows = await this.contracts.list(shopId, filter, today, after, CONTRACT_PAGE_SIZE + 1);
    const hasMore = rows.length > CONTRACT_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, CONTRACT_PAGE_SIZE) : rows;
    return { items: page.map((row) => toItem(row, today)), nextAfter: hasMore ? page[page.length - 1].id : null, today };
  }

  /** Mọi hợp đồng khớp bộ lọc, từng lô theo keyset (xuất Excel); cùng một "hôm nay" cho cả file. */
  async *batches(shopId: string, filter: ContractFilter, now = new Date()): AsyncGenerator<ContractListItem[]> {
    const today = businessDate(now);
    let after: string | null = null;
    for (;;) {
      const rows = await this.contracts.list(shopId, filter, today, after, EXPORT_BATCH_SIZE);
      if (rows.length > 0) yield rows.map((row) => toItem(row, today));
      if (rows.length < EXPORT_BATCH_SIZE) return;
      after = rows[rows.length - 1].id;
    }
  }
}

function toItem(row: ContractListRow, today: LocalDate): ContractListItem {
  // Hợp đồng đã xoá không còn lãi, hạn (kể cả khi xoá lúc đang mở).
  const active = row.status === "active" && !row.deleted;
  return {
    ...row,
    rateText: formatRate(row.interestRate),
    accruedInterest: active ? accruedInterest(row, today) : null,
    nextInterestDue: active ? nextInterestDue(row) : null,
  };
}
