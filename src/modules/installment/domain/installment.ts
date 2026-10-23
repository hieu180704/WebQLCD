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

/** Kỳ đầu và kỳ cuối mà một lần thu chạm tới, khi số đã thu đi từ `before` lên `after` ("Góp kỳ 7–8"). */
export function periodsCovered(
  s: Pick<Schedule, "totalDue" | "totalDays" | "periodDays">,
  before: Money,
  after: Money,
): { first: number; last: number } {
  const n = periodCount(s);
  const first = Math.min(n, paidPeriods(s, before) + 1);
  // Kỳ nhỏ nhất có luỹ kế >= after = (số kỳ có luỹ kế < after) + 1.
  const last = Math.min(n, paidPeriods(s, after.subtract(Money.of(1n))) + 1);
  return { first, last: Math.max(first, last) };
}

export type SchedulePeriod = {
  index: number;
  due: LocalDate;
  amount: Money;
  /** Phần đã góp vào kỳ này (góp dư kỳ trước dồn sang, góp thiếu thì nhỏ hơn `amount`). */
  paid: Money;
  /** Ngày nghiệp vụ của lần thu làm kỳ này đủ tiền; null khi chưa đủ. */
  paidOn: LocalDate | null;
};

/**
 * Các kỳ `from..to` của lịch góp. `payments` là các lần thu chưa huỷ, cũ trước; tiền dồn từ kỳ đầu (góp dư dồn sang kỳ sau),
 * nên ngày góp đủ của kỳ k là ngày của lần thu đưa luỹ kế đã thu lên tới luỹ kế phải thu kỳ k.
 */
export function schedulePeriods(
  c: InstallmentStanding,
  payments: readonly { on: LocalDate; amount: Money }[],
  from: number,
  to: number,
): SchedulePeriod[] {
  const periods: SchedulePeriod[] = [];
  let p = 0;
  let cumulative = Money.ZERO;
  for (let k = Math.max(1, from); k <= Math.min(to, periodCount(c)); k++) {
    const start = dueThrough(c, k - 1);
    const end = dueThrough(c, k);
    let paidOn: LocalDate | null = null;
    if (c.amountPaid.compare(end) >= 0) {
      while (p < payments.length && cumulative.compare(end) < 0) cumulative = cumulative.add(payments[p++].amount);
      paidOn = cumulative.compare(end) >= 0 && p > 0 ? payments[p - 1].on : null;
    }
    const over = c.amountPaid.subtract(start);
    const amount = end.subtract(start);
    const paid = over.isNegative() ? Money.ZERO : over.compare(amount) > 0 ? amount : over;
    periods.push({ index: k, due: periodDueDate(c, k), amount, paid, paidOn });
  }
  return periods;
}

/** Số kỳ tối đa liệt kê trong ô "góp đến hết kỳ"; nhiều hơn thì nhập số tiền hoặc tất toán. */
const MAX_PAYMENT_OPTIONS = 24;

export type PaymentOption = { index: number; due: LocalDate; amount: Money };

/** Lựa chọn "góp đến hết kỳ k" gợi ý số tiền = luỹ kế phải thu kỳ k − đã thu (GIẢ ĐỊNH TẠM, core-spec mục 2). */
export function paymentOptions(c: InstallmentStanding): PaymentOption[] {
  const n = periodCount(c);
  const paid = paidPeriods(c, c.amountPaid);
  const options: PaymentOption[] = [];
  for (let k = paid + 1; k <= Math.min(n, paid + MAX_PAYMENT_OPTIONS); k++) {
    options.push({ index: k, due: periodDueDate(c, k), amount: dueThrough(c, k).subtract(c.amountPaid) });
  }
  return options;
}

export type Payment = {
  amount: Money;
  paidAfter: Money;
  /** Thu đủ tổng phải thu: hợp đồng tự chuyển "Đã đóng". */
  closes: boolean;
};

export type PaymentViolation = "amount_not_positive" | "amount_exceeds_remaining";

/** Đóng tiền góp: số tiền tự do, 0 < tiền ≤ còn phải thu; góp lẻ, góp dư dồn sang kỳ sau. */
export function planPayment(c: InstallmentStanding, amount: Money): { ok: true; value: Payment } | { ok: false; error: PaymentViolation } {
  if (!amount.isPositive()) return { ok: false, error: "amount_not_positive" };
  const remaining = c.totalDue.subtract(c.amountPaid);
  if (amount.compare(remaining) > 0) return { ok: false, error: "amount_exceeds_remaining" };
  const paidAfter = c.amountPaid.add(amount);
  return { ok: true, value: { amount, paidAfter, closes: paidAfter.equals(c.totalDue) } };
}

export type SettlementViolation = "amount_negative" | "amount_exceeds_remaining";

/**
 * Đóng / tất toán: `amount` null = thu đủ còn phải thu; có nhập thì được thấp hơn, kể cả 0 (tiệm giảm cho khách tất toán
 * sớm, phần chênh không thu), không được cao hơn. Hợp đồng chuyển "Đã đóng".
 */
export function planSettlement(
  c: InstallmentStanding,
  amount: Money | null,
): { ok: true; value: Payment } | { ok: false; error: SettlementViolation } {
  const remaining = c.totalDue.subtract(c.amountPaid);
  const value = amount ?? remaining;
  if (value.isNegative()) return { ok: false, error: "amount_negative" };
  if (value.compare(remaining) > 0) return { ok: false, error: "amount_exceeds_remaining" };
  return { ok: true, value: { amount: value, paidAfter: c.amountPaid.add(value), closes: true } };
}

/** Loại thao tác trên hợp đồng trả góp (bảng `installment_operations`). */
export type OperationKind = "disbursement" | "pay" | "close";

/** Huỷ giao dịch: chỉ thao tác mới nhất chưa huỷ, không huỷ riêng giải ngân (muốn bỏ hợp đồng thì xoá). */
export const isReversible = (kind: OperationKind) => kind !== "disbursement";
