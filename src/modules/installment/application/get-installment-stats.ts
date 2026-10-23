import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { InstallmentRepository, InstallmentStats } from "./ports";

export type { InstallmentStats };

/** Ngày đầu tháng của `date` và ngày đầu tháng sau ("2026-12-15" → ["2026-12-01", "2027-01-01"]). */
export function monthRange(date: LocalDate): [LocalDate, LocalDate] {
  const [year, month] = date.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return [`${date.slice(0, 7)}-01`, `${next}-01`];
}

/** 4 ô thống kê đầu trang danh sách trả góp, của cả cửa hàng (không theo bộ lọc). */
export class GetInstallmentStats {
  constructor(private readonly installments: InstallmentRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, now = new Date()): Promise<InstallmentStats> {
    const today = businessDate(now);
    const [monthStart, nextMonthStart] = monthRange(today);
    return this.installments.stats(shopId, today, monthStart, nextMonthStart);
  }
}
