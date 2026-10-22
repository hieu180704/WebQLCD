import type { CashActor, CashbookRepository } from "./ports";

/** Danh sách người thực hiện cho bộ lọc sổ quỹ (chủ tiệm + KTV, kể cả KTV đã khoá vì vẫn còn giao dịch cũ). */
export class ListCashActors {
  constructor(private readonly cashbook: CashbookRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  execute(shopId: string): Promise<CashActor[]> {
    return this.cashbook.listActors(shopId);
  }
}
