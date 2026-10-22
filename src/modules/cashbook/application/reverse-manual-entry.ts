import { businessDate } from "@/shared/kernel/local-date";
import type { Actor, CashbookRepository, ReverseManualResult } from "./ports";

export type ReverseManualEntryResult = ReverseManualResult | "reason_required";

/**
 * Huỷ phiếu thu khác / chi khác / nạp vốn bằng bút toán đảo ghi vào hôm nay (core-spec mục 2).
 * Chỉ chủ tiệm (guard kiểm ở presentation). Giao dịch hợp đồng huỷ ở trang hợp đồng, không qua đây.
 */
export class ReverseManualEntry {
  constructor(private readonly cashbook: CashbookRepository) {}

  async execute(actor: Actor, transactionId: string, reason: string, now = new Date()): Promise<ReverseManualEntryResult> {
    if (!reason) return "reason_required";
    return this.cashbook.reverseManualEntry(actor, transactionId, reason, businessDate(now));
  }
}
