import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { accruedInterest, nextInterestDue } from "../domain/contract";
import { formatRate } from "../domain/interest/rate";
import type { ContractFilter, ContractListRow, ContractRepository } from "./ports";

export const CONTRACT_PAGE_SIZE = 50;

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
    const items = page.map((row) => {
      // Hợp đồng đã xoá không còn lãi, hạn (kể cả khi xoá lúc đang mở).
      const active = row.status === "active" && !row.deleted;
      return {
        ...row,
        rateText: formatRate(row.interestRate),
        accruedInterest: active ? accruedInterest(row, today) : null,
        nextInterestDue: active ? nextInterestDue(row) : null,
      };
    });
    return { items, nextAfter: hasMore ? page[page.length - 1].id : null, today };
  }
}
