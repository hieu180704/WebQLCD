// Ngày lịch dạng "YYYY-MM-DD" (khớp cột `date` của PostgreSQL), không mang giờ và múi giờ.
export type LocalDate = string;

export const BUSINESS_TIME_ZONE = "Asia/Ho_Chi_Minh";

const DAY_MS = 24 * 60 * 60 * 1000;
const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// en-CA định dạng ngày đúng kiểu YYYY-MM-DD.
const formatBusinessDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format;

/** Ngày nghiệp vụ của thời điểm `now` theo giờ Việt Nam (data-model mục 2.8). */
export function businessDate(now: Date): LocalDate {
  return formatBusinessDate(now);
}

/** Chuỗi đúng định dạng và là ngày có thật (loại 2026-02-30). */
export function isLocalDate(value: string): boolean {
  if (!PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`); // Tháng 13, ngày 45… cho NaN.
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(value);
}

function toUtcMs(date: LocalDate): number {
  if (!isLocalDate(date)) throw new RangeError(`Ngày không hợp lệ: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Số ngày từ `from` đến `to` (âm nếu `to` trước `from`). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}
