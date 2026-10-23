import { addDays, diffDays, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";

export const CODE_PREFIX = "TG-";

/** Hợp đồng trả góp kiểu "bát họ" (core-spec mục 3): đưa khách một khoản, thu lại tổng phải thu chia đều theo kỳ. */
export type InstallmentTerms = {
  amountGiven: Money;
  totalDue: Money;
  totalDays: number;
  periodDays: number;
  startDate: LocalDate;
};

export type InstallmentRuleViolation = "amount_not_positive" | "total_less_than_given" | "period_exceeds_total" | "start_date_in_future";

/** Kiểm quy tắc nghiệp vụ khi tạo hợp đồng. `today` là ngày nghiệp vụ hiện tại. */
export function checkTerms(terms: InstallmentTerms, today: LocalDate): InstallmentRuleViolation | null {
  if (!terms.amountGiven.isPositive()) return "amount_not_positive";
  if (terms.totalDue.compare(terms.amountGiven) < 0) return "total_less_than_given";
  if (terms.periodDays > terms.totalDays) return "period_exceeds_total";
  if (diffDays(today, terms.startDate) > 0) return "start_date_in_future";
  return null;
}

type Schedule = Pick<InstallmentTerms, "totalDue" | "totalDays" | "periodDays" | "startDate">;

/** Số kỳ = số ngày góp / số ngày mỗi kỳ, làm tròn lên: kỳ cuối ngắn hơn khi chia không hết (GIẢ ĐỊNH TẠM, core-spec mục 2). */
export const periodCount = (s: Pick<Schedule, "totalDays" | "periodDays">) => Math.ceil(s.totalDays / s.periodDays);

/**
 * Phải thu luỹ kế đến hết kỳ `k` = tổng phải thu × k / số kỳ, làm tròn half-up về 1 đồng. Tiền từng kỳ là phần chênh của
 * hai mức luỹ kế liền nhau nên tổng các kỳ luôn đúng bằng tổng phải thu. Hàm SQL `installment_due_through` tính như hàm này.
 */
export function dueThrough(s: Pick<Schedule, "totalDue" | "totalDays" | "periodDays">, k: number): Money {
  if (k <= 0) return Money.ZERO;
  const n = periodCount(s);
  return s.totalDue.mulDiv(BigInt(Math.min(k, n)), BigInt(n));
}

/** Ngày phải góp của kỳ `k` (đếm từ 1): ngày bắt đầu + k × số ngày mỗi kỳ, kỳ cuối là ngày kết thúc. */
export function periodDueDate(s: Pick<Schedule, "totalDays" | "periodDays" | "startDate">, k: number): LocalDate {
  return addDays(s.startDate, Math.min(k * s.periodDays, s.totalDays));
}

export const endDate = (s: Pick<Schedule, "totalDays" | "startDate">) => addDays(s.startDate, s.totalDays);

/** Số kỳ đã góp đủ với số tiền đã thu `paid` (góp thiếu, góp dư dồn sang kỳ sau). */
export function paidPeriods(s: Pick<Schedule, "totalDue" | "totalDays" | "periodDays">, paid: Money): number {
  const n = periodCount(s);
  // Luỹ kế tăng theo k: tìm nhị phân kỳ lớn nhất có luỹ kế <= paid.
  let low = 0;
  let high = n;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (dueThrough(s, mid).compare(paid) <= 0) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Số kỳ có ngày phải góp trước `today` (đã tới hạn và qua ngày). */
function periodsDueBefore(s: Pick<Schedule, "totalDays" | "periodDays" | "startDate">, today: LocalDate): number {
  const elapsed = diffDays(s.startDate, today);
  if (elapsed <= 0) return 0;
  if (elapsed > s.totalDays) return periodCount(s);
  return Math.min(periodCount(s), Math.floor((elapsed - 1) / s.periodDays));
}

export type InstallmentStanding = Schedule & { amountPaid: Money };

export type Progress = {
  periods: number;
  paidPeriods: number;
  /** Kỳ đầu tiên chưa góp đủ; null khi đã góp đủ mọi kỳ. */
  next: { index: number; due: LocalDate; remaining: Money } | null;
  /** Số kỳ đã qua ngày phải góp mà chưa góp đủ. */
  lateCount: number;
  remaining: Money;
};

/** Tiến độ góp tính lúc đọc (data-model mục 2.7). */
export function progress(c: InstallmentStanding, today: LocalDate): Progress {
  const periods = periodCount(c);
  const paid = paidPeriods(c, c.amountPaid);
  const next =
    paid < periods ? { index: paid + 1, due: periodDueDate(c, paid + 1), remaining: dueThrough(c, paid + 1).subtract(c.amountPaid) } : null;
  return {
    periods,
    paidPeriods: paid,
    next,
    lateCount: Math.max(0, periodsDueBefore(c, today) - paid),
    remaining: c.totalDue.subtract(c.amountPaid),
  };
}

export type DueStatus = { kind: "late"; periods: number } | { kind: "today" } | { kind: "on_time" };

/** Nhãn hạn góp của hợp đồng đang góp: chậm N kỳ, đến hạn hôm nay, hoặc đúng hạn. */
export function dueStatus(p: Progress, today: LocalDate): DueStatus {
  if (p.lateCount > 0) return { kind: "late", periods: p.lateCount };
  if (p.next && p.next.due === today) return { kind: "today" };
  return { kind: "on_time" };
}

export type RateWarning = "none" | "above_civil_cap" | "criminal_risk";

const CIVIL_CAP_PERCENT = 20n; // Điều 468 Bộ luật Dân sự 2015
const CRIMINAL_PERCENT = 100n; // Điều 201 Bộ luật Hình sự

/**
 * Cảnh báo lãi trả góp (GIẢ ĐỊNH TẠM, core-spec mục 2): lãi quy đổi %/năm = (tổng phải thu − tiền đưa khách) / tiền đưa
 * khách × 365 / số ngày góp. > 20 vàng, ≥ 100 đỏ; không chặn lưu.
 */
export function rateWarning(t: Pick<InstallmentTerms, "amountGiven" | "totalDue" | "totalDays">): RateWarning {
  // So sánh lời × 365 × 100 với ngưỡng × tiền đưa × số ngày, nhân chéo để giữ số nguyên.
  const lhs = t.totalDue.subtract(t.amountGiven).toBigInt() * 365n * 100n;
  const base = t.amountGiven.toBigInt() * BigInt(t.totalDays);
  if (lhs >= CRIMINAL_PERCENT * base) return "criminal_risk";
  if (lhs > CIVIL_CAP_PERCENT * base) return "above_civil_cap";
  return "none";
}

/** Lãi suất quy đổi %/năm để hiển thị, làm tròn 1 chữ số thập phân. */
export function annualPercent(t: Pick<InstallmentTerms, "amountGiven" | "totalDue" | "totalDays">): number {
  const profit = t.totalDue.subtract(t.amountGiven);
  const tenths = profit.mulDiv(365n * 100n * 10n, t.amountGiven.toBigInt() * BigInt(t.totalDays));
  return Number(tenths.toBigInt()) / 10;
}
