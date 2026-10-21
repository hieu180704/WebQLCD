import { diffDays } from "@/shared/kernel/local-date";
import type { ContractListRow } from "../application/ports";
import type { InterestType } from "../application/preview";

export const INTEREST_UNIT: Record<InterestType, string> = {
  per_million_per_day: "k/triệu/ngày",
  percent_per_month: "%/tháng",
  percent_per_week: "%/tuần",
};

/** "2026-10-05" → "05/10/2026". */
export const formatDay = (date: string) => date.split("-").reverse().join("/");

/** Nhãn hạn đóng lãi theo mockup cam-do.html; `due` null = hợp đồng đã đóng ("Đã chuộc" với cầm đồ, kèm ngày nếu có). */
export function DueBadge({ due, today, kind, closedOn }: { due: string | null; today: string; kind: ContractListRow["kind"]; closedOn?: string | null }) {
  if (!due) {
    const label = kind === "secured" ? "Đã chuộc" : "Đã đóng";
    return <span className="badge badge-muted">{closedOn ? `${label} ${formatDay(closedOn)}` : label}</span>;
  }
  const days = diffDays(today, due);
  if (days < 0) return <span className="badge badge-late">Quá {-days} ngày</span>;
  if (days === 0) return <span className="badge badge-warn">Hôm nay</span>;
  return <span className="badge badge-ok">Đang vay</span>;
}
