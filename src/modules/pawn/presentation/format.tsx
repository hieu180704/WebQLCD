import { diffDays } from "@/shared/kernel/local-date";
import type { ContractCashType, ContractListRow } from "../application/ports";
import type { InterestType } from "../application/preview";

/** Nội dung dòng sổ két của hợp đồng (lịch sử giao dịch ở chi tiết hợp đồng, chi tiết khách). */
export const CONTRACT_CASH_LABEL: Record<ContractCashType, string> = {
  disbursement: "Giải ngân, tạo hợp đồng",
  additional_loan: "Vay thêm",
  interest_payment: "Đóng lãi",
  principal_repayment: "Trả gốc",
  reversal: "Huỷ giao dịch",
};

/** Lựa chọn hình thức lãi ở form tạo hợp đồng và mặc định ở trang Cài đặt. */
export const INTEREST_TYPE_OPTIONS: { value: InterestType; label: string }[] = [
  { value: "per_million_per_day", label: "Lãi ngày (k / triệu / ngày)" },
  { value: "percent_per_month", label: "Lãi tháng (% / tháng)" },
  { value: "percent_per_week", label: "Lãi tuần (% / tuần)" },
];

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
