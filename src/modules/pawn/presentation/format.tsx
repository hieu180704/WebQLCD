import { diffDays } from "@/shared/kernel/local-date";
import type { InterestType } from "../application/preview";

export const INTEREST_UNIT: Record<InterestType, string> = {
  per_million_per_day: "k/triệu/ngày",
  percent_per_month: "%/tháng",
  percent_per_week: "%/tuần",
};

/** "2026-10-05" → "05/10/2026". */
export const formatDay = (date: string) => date.split("-").reverse().join("/");

/** Nhãn hạn đóng lãi theo mockup cam-do.html; null = hợp đồng đã đóng. */
export function DueBadge({ due, today }: { due: string | null; today: string }) {
  if (!due) return <span className="badge badge-muted">Đã đóng</span>;
  const days = diffDays(today, due);
  if (days < 0) return <span className="badge badge-late">Quá {-days} ngày</span>;
  if (days === 0) return <span className="badge badge-warn">Hôm nay</span>;
  return <span className="badge badge-ok">Đang vay</span>;
}
