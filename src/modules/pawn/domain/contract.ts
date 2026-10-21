import { addDays, diffDays, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { interestPolicy, type InterestType } from "./interest/interest-policy";

/** Cầm đồ = thế chấp (`secured`), tín chấp = `unsecured` (core-spec mục 2). */
export type ContractKind = "secured" | "unsecured";

export const CODE_PREFIX: Record<ContractKind, "CD-" | "TC-"> = { secured: "CD-", unsecured: "TC-" };

export type ContractTerms = {
  kind: ContractKind;
  assetName: string | null;
  principal: Money;
  interestType: InterestType;
  /** Đã nhân RATE_SCALE. */
  interestRate: bigint;
  interestPeriodDays: number;
  termDays: number;
  loanDate: LocalDate;
  prepaidInterest: boolean;
};

/** Khoảng lãi nửa mở [from, to): `to` là ngày lãi đã trả đến (data-model mục 3.4, `interest_paid_until`). */
export type InterestPeriod = { from: LocalDate; to: LocalDate; amount: Money };

export type Disbursement = {
  /** Gốc giao khách, ghi sổ két dạng `disbursement`. */
  principal: Money;
  /** Lãi kỳ đầu thu ngay lúc giải ngân khi bật "Thu lãi trước". */
  prepaid: InterestPeriod | null;
  /** Tiền thực giao khách = gốc − lãi thu trước. */
  cashToCustomer: Money;
  interestPaidUntil: LocalDate;
};

export type ContractRuleViolation =
  | "asset_required"
  | "principal_not_positive"
  | "period_exceeds_term"
  | "loan_date_in_future"
  | "prepaid_not_less_than_principal";

/**
 * Kiểm quy tắc nghiệp vụ và lập phương án giải ngân. `today` là ngày nghiệp vụ hiện tại.
 * Lãi trước tính trên kỳ đầu kể từ ngày vay.
 */
export function planDisbursement(
  terms: ContractTerms,
  today: LocalDate,
): { ok: true; value: Disbursement } | { ok: false; error: ContractRuleViolation } {
  if (terms.kind === "secured" && !terms.assetName?.trim()) return { ok: false, error: "asset_required" };
  if (!terms.principal.isPositive()) return { ok: false, error: "principal_not_positive" };
  if (terms.interestPeriodDays > terms.termDays) return { ok: false, error: "period_exceeds_term" };
  if (diffDays(today, terms.loanDate) > 0) return { ok: false, error: "loan_date_in_future" };

  if (!terms.prepaidInterest) {
    return {
      ok: true,
      value: { principal: terms.principal, prepaid: null, cashToCustomer: terms.principal, interestPaidUntil: terms.loanDate },
    };
  }

  const amount = interestPolicy(terms.interestType).interestFor(terms.principal, terms.interestRate, terms.interestPeriodDays);
  if (amount.compare(terms.principal) >= 0) return { ok: false, error: "prepaid_not_less_than_principal" };
  // Lãi bằng 0 (lãi suất 0) thì không có dòng thu lãi (sổ két cấm amount = 0), nên `interest_paid_until`
  // giữ bằng ngày vay để khớp truy vấn đối soát (data-model mục 4).
  if (amount.isZero()) {
    return {
      ok: true,
      value: { principal: terms.principal, prepaid: null, cashToCustomer: terms.principal, interestPaidUntil: terms.loanDate },
    };
  }
  const to = addDays(terms.loanDate, terms.interestPeriodDays);
  return {
    ok: true,
    value: {
      principal: terms.principal,
      prepaid: { from: terms.loanDate, to, amount },
      cashToCustomer: terms.principal.subtract(amount),
      interestPaidUntil: to,
    },
  };
}

export type InterestStanding = {
  interestType: InterestType;
  interestRate: bigint;
  interestPeriodDays: number;
  outstandingPrincipal: Money;
  interestPaidUntil: LocalDate;
};

/** Lãi phát sinh từ ngày đã trả đến tới hôm nay, trên gốc còn lại; tính lúc đọc (data-model mục 2.7). */
export function accruedInterest(contract: InterestStanding, today: LocalDate): Money {
  const days = diffDays(contract.interestPaidUntil, today);
  if (days <= 0) return Money.ZERO;
  return interestPolicy(contract.interestType).interestFor(contract.outstandingPrincipal, contract.interestRate, days);
}

/**
 * Hạn đóng lãi kỳ tiếp theo. Thu lãi trước: kỳ sau đóng ngay đầu kỳ, tức ngày đã trả đến.
 * Thu lãi sau: đóng cuối kỳ, tức ngày đã trả đến + kỳ lãi.
 */
export function nextInterestDue(
  contract: Pick<InterestStanding, "interestPaidUntil" | "interestPeriodDays"> & { prepaidInterest: boolean },
): LocalDate {
  if (contract.prepaidInterest) return contract.interestPaidUntil;
  return addDays(contract.interestPaidUntil, contract.interestPeriodDays);
}

export type PayableStanding = InterestStanding & { prepaidInterest: boolean };

/** Hạn đóng của kỳ thứ `k` (đếm từ 1) kể từ ngày đã trả đến; quy ước như `nextInterestDue`. */
function periodDue(contract: PayableStanding, k: number): LocalDate {
  const start = addDays(contract.interestPaidUntil, (k - 1) * contract.interestPeriodDays);
  return contract.prepaidInterest ? start : addDays(start, contract.interestPeriodDays);
}

/** Số kỳ tối đa chọn được trong một lần đóng lãi. */
const MAX_PERIODS_PER_PAYMENT = 24;

/**
 * Các lựa chọn "đóng đến hết kỳ k": mọi kỳ đã tới hạn tính đến hôm nay, thêm một kỳ kế tiếp (đóng sớm).
 * Lãi tính trên gốc còn lại cho cả k kỳ, làm tròn một lần. Lãi bằng 0 (lãi suất 0) thì không có lựa chọn.
 */
export function interestOptions(contract: PayableStanding, today: LocalDate): InterestPeriod[] {
  let due = 0;
  while (due < MAX_PERIODS_PER_PAYMENT && diffDays(periodDue(contract, due + 1), today) >= 0) due++;
  const count = Math.min(due + 1, MAX_PERIODS_PER_PAYMENT);
  const policy = interestPolicy(contract.interestType);
  const options: InterestPeriod[] = [];
  for (let k = 1; k <= count; k++) {
    const days = k * contract.interestPeriodDays;
    const amount = policy.interestFor(contract.outstandingPrincipal, contract.interestRate, days);
    if (amount.isZero()) return [];
    options.push({ from: contract.interestPaidUntil, to: addDays(contract.interestPaidUntil, days), amount });
  }
  return options;
}

export type InterestPaymentViolation = "no_interest_due" | "invalid_periods" | "amount_not_positive" | "amount_exceeds_due";

/**
 * Đóng lãi theo kỳ nguyên (GIẢ ĐỊNH TẠM, core-spec mục 2): `periods` là số kỳ đóng, phải nằm trong `interestOptions`.
 * `amount` null = thu đúng lãi tính được; có nhập thì được thu ít hơn (giảm lãi), không được thu nhiều hơn.
 */
export function planInterestPayment(
  contract: PayableStanding,
  today: LocalDate,
  periods: number,
  amount: Money | null,
): { ok: true; value: InterestPeriod } | { ok: false; error: InterestPaymentViolation } {
  const options = interestOptions(contract, today);
  if (options.length === 0) return { ok: false, error: "no_interest_due" };
  const option = options[periods - 1];
  if (!Number.isSafeInteger(periods) || !option) return { ok: false, error: "invalid_periods" };
  if (amount === null) return { ok: true, value: option };
  if (!amount.isPositive()) return { ok: false, error: "amount_not_positive" };
  if (amount.compare(option.amount) > 0) return { ok: false, error: "amount_exceeds_due" };
  return { ok: true, value: { ...option, amount } };
}

export type ScheduledPeriod = InterestPeriod & { due: LocalDate };

/** Lịch các kỳ chưa đóng: từ ngày đã trả đến tới hết hạn vay (hoặc hôm nay nếu đã quá hạn), ít nhất 1 kỳ, tối đa `max` kỳ. */
export function upcomingPeriods(contract: PayableStanding, termEnd: LocalDate, today: LocalDate, max = 12): ScheduledPeriod[] {
  const until = diffDays(termEnd, today) > 0 ? today : termEnd;
  const amount = interestPolicy(contract.interestType).interestFor(
    contract.outstandingPrincipal,
    contract.interestRate,
    contract.interestPeriodDays,
  );
  const periods: ScheduledPeriod[] = [];
  for (let k = 1; k <= max; k++) {
    const from = addDays(contract.interestPaidUntil, (k - 1) * contract.interestPeriodDays);
    if (k > 1 && diffDays(from, until) <= 0) break;
    periods.push({ from, to: addDays(from, contract.interestPeriodDays), amount, due: periodDue(contract, k) });
  }
  return periods;
}
