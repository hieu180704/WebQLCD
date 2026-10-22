import { businessDate } from "@/shared/kernel/local-date";
import type { Actor, CashbookRepository, ManualEntry } from "./ports";

export type RecordManualEntryResult = "ok" | "not_positive" | "note_required";

/**
 * Ghi phiếu thu khác / chi khác / nạp vốn vào sổ két hôm nay (core-spec mục 2).
 * Quyền (nạp vốn chỉ chủ tiệm) do guard kiểm ở presentation. Két được phép âm nên chi khác không bị chặn.
 */
export class RecordManualEntry {
  constructor(private readonly cashbook: CashbookRepository) {}

  async execute(actor: Actor, entry: ManualEntry, now = new Date()): Promise<RecordManualEntryResult> {
    if (!entry.amount.isPositive()) return "not_positive";
    // Thu khác / chi khác bắt buộc nội dung; nạp vốn ghi chú tuỳ chọn.
    if (entry.type !== "capital_in" && !entry.note) return "note_required";
    await this.cashbook.recordManualEntry(actor, entry, businessDate(now));
    return "ok";
  }
}
