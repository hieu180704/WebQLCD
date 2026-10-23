import type { DueStatus } from "../application/list-installments";

/** "2026-10-05" → "05/10/2026". */
export const formatDay = (date: string) => date.split("-").reverse().join("/");

/** Nhãn hạn góp theo mockup tra-gop.html; `status` null = hợp đồng đã đóng. */
export function dueLabel(status: DueStatus | null): { text: string; badge: string } {
  if (!status) return { text: "Đã đóng", badge: "badge-muted" };
  switch (status.kind) {
    case "late":
      return { text: `Chậm ${status.periods} kỳ`, badge: "badge-late" };
    case "today":
      return { text: "Hôm nay", badge: "badge-warn" };
    case "on_time":
      return { text: "Đúng hạn", badge: "badge-ok" };
  }
}

export function DueBadge({ status }: { status: DueStatus | null }) {
  const { text, badge } = dueLabel(status);
  return <span className={`badge ${badge}`}>{text}</span>;
}

/** Thanh tiến độ "8 / 25 kỳ". Dùng `<progress>` vì CSP không cho thuộc tính style inline (style-src chỉ có nonce). */
export function ProgressBar({ paid, total, className = "w-28" }: { paid: number; total: number; className?: string }) {
  const bar =
    paid === total
      ? "[&::-webkit-progress-value]:bg-emerald-600 [&::-moz-progress-bar]:bg-emerald-600"
      : "[&::-webkit-progress-value]:bg-teal-600 [&::-moz-progress-bar]:bg-teal-600";
  return (
    <progress
      value={paid}
      max={total}
      aria-label={`Đã góp ${paid} / ${total} kỳ`}
      className={`block h-2 appearance-none overflow-hidden rounded-full bg-slate-100 [&::-webkit-progress-bar]:bg-slate-100 [&::-webkit-progress-value]:rounded-full ${bar} ${className}`}
    />
  );
}
