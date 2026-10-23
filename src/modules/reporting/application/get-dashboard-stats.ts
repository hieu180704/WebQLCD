import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";

/** Thống kê hợp đồng ở trang chủ và `/cam-do` (cầm đồ/tín chấp; chưa tính trả góp). */
export type DashboardStats = {
  /** Σ gốc còn lại của hợp đồng đang mở, chưa xoá. */
  lending: Money;
  openSecured: number;
  openUnsecured: number;
  /** Lãi thu trong tháng theo ngày nghiệp vụ, đã trừ dòng đảo lãi ghi trong tháng. */
  interestThisMonth: Money;
  /** Σ lãi từ ngày đã trả đến tới hôm nay trên gốc còn lại của hợp đồng đang mở, chưa xoá (ô ở `/cam-do`). */
  accruedInterest: Money;
  /** Số hợp đồng có hạn đóng lãi trước hôm nay. */
  overdue: number;
};

/** Khoảng tháng nửa mở [from, to) theo ngày nghiệp vụ. */
export type MonthRange = { from: LocalDate; to: LocalDate };

export interface DashboardStatsSource {
  /** Mọi truy vấn lọc theo `shopId` của phiên. */
  load(shopId: string, today: LocalDate, month: MonthRange): Promise<DashboardStats>;
}

/** Tháng chứa `date`: "2026-12-15" → [2026-12-01, 2027-01-01). */
export function monthOf(date: LocalDate): MonthRange {
  const [year, month] = date.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { from: `${date.slice(0, 7)}-01`, to: `${next}-01` };
}

export class GetDashboardStats {
  constructor(private readonly source: DashboardStatsSource) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, now = new Date()): Promise<DashboardStats> {
    const today = businessDate(now);
    return this.source.load(shopId, today, monthOf(today));
  }
}
