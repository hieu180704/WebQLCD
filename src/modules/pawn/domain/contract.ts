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

export type Redemption = {
  /** Lãi thu khi chuộc, kỳ [ngày trả đến, hôm nay); null = không thu lãi (không phát sinh, hoặc giảm hết). */
  interest: InterestPeriod | null;
  /** Gốc còn lại, thu đủ. */
  principal: Money;
};

export type RedemptionViolation = "interest_negative" | "interest_exceeds_due";

/**
 * Chuộc đồ / đóng hợp đồng (GIẢ ĐỊNH TẠM, core-spec mục 2): thu lãi theo ngày đến hôm nay (`accruedInterest`) và đủ gốc
 * còn lại. `interest` null = thu đúng lãi tính được; có nhập thì được thu ít hơn, kể cả 0 (giảm lãi), không được thu nhiều
 * hơn. Lãi đã trả vượt quá hôm nay thì lãi bằng 0, không hoàn phần đã trả.
 */
export function planRedemption(
  contract: InterestStanding,
  today: LocalDate,
  interest: Money | null,
): { ok: true; value: Redemption } | { ok: false; error: RedemptionViolation } {
  const due = accruedInterest(contract, today);
  const amount = interest ?? due;
  if (amount.isNegative()) return { ok: false, error: "interest_negative" };
  if (amount.compare(due) > 0) return { ok: false, error: "interest_exceeds_due" };
  return {
    ok: true,
    value: {
      interest: amount.isZero() ? null : { from: contract.interestPaidUntil, to: today, amount },
      principal: contract.outstandingPrincipal,
    },
  };
}

export type InterestSettlementViolation = "interest_not_positive" | "interest_exceeds_due";

/**
 * Lãi thu kèm một thao tác: `entered` null = thu đúng `due.amount`; có nhập thì được giảm nhưng phải > 0 (sổ két cấm
 * amount = 0, nên giảm về 0 thì không dời được ngày trả đến). `due` null = không có lãi để thu, chỉ nhận null hoặc 0.
 */
function settleInterest(
  due: InterestPeriod | null,
  entered: Money | null,
): { ok: true; value: InterestPeriod | null } | { ok: false; error: InterestSettlementViolation } {
  if (!due) {
    if (entered === null || entered.isZero()) return { ok: true, value: null };
    return { ok: false, error: "interest_exceeds_due" };
  }
  if (entered === null) return { ok: true, value: due };
  if (!entered.isPositive()) return { ok: false, error: "interest_not_positive" };
  if (entered.compare(due.amount) > 0) return { ok: false, error: "interest_exceeds_due" };
  return { ok: true, value: { ...due, amount: entered } };
}

/** Lãi theo ngày [ngày trả đến, hôm nay) trên gốc còn lại; null khi bằng 0. */
function interestToToday(contract: InterestStanding, today: LocalDate): InterestPeriod | null {
  const amount = accruedInterest(contract, today);
  return amount.isZero() ? null : { from: contract.interestPaidUntil, to: today, amount };
}

export type PrincipalChange = {
  /** Lãi thu kèm, chung thao tác với dòng gốc; null = không thu. */
  interest: InterestPeriod | null;
  /** Số tiền trả bớt / vay thêm (dương). */
  amount: Money;
  outstandingAfter: Money;
};

export type PrincipalChangeViolation = InterestSettlementViolation | "amount_not_positive" | "amount_not_less_than_outstanding";

/**
 * Trả bớt gốc (GIẢ ĐỊNH TẠM, core-spec mục 2): 0 < tiền < gốc còn lại (trả hết thì dùng chuộc đồ). Lãi đến hôm nay trên
 * gốc cũ bắt buộc thu kèm để ngày trả đến về hôm nay, lãi từ hôm nay tính trên gốc mới. Lãi đã trả vượt hôm nay: không hoàn.
 */
export function planPrincipalRepayment(
  contract: InterestStanding,
  today: LocalDate,
  amount: Money,
  interest: Money | null,
): { ok: true; value: PrincipalChange } | { ok: false; error: PrincipalChangeViolation } {
  if (!amount.isPositive()) return { ok: false, error: "amount_not_positive" };
  if (amount.compare(contract.outstandingPrincipal) >= 0) return { ok: false, error: "amount_not_less_than_outstanding" };
  const settled = settleInterest(interestToToday(contract, today), interest);
  if (!settled.ok) return settled;
  return { ok: true, value: { interest: settled.value, amount, outstandingAfter: contract.outstandingPrincipal.subtract(amount) } };
}

/**
 * Vay thêm (GIẢ ĐỊNH TẠM, core-spec mục 2): lãi từ hôm nay tính trên gốc mới. Ngày trả đến trước hôm nay: thu kèm lãi
 * [ngày trả đến, hôm nay) trên gốc cũ. Ngày trả đến sau hôm nay (thu lãi trước, đóng sớm): thu lãi bổ sung trên phần vay
 * thêm cho [hôm nay, ngày trả đến), ngày trả đến giữ nguyên.
 */
export function planAdditionalLoan(
  contract: InterestStanding,
  today: LocalDate,
  amount: Money,
  interest: Money | null,
): { ok: true; value: PrincipalChange } | { ok: false; error: PrincipalChangeViolation } {
  if (!amount.isPositive()) return { ok: false, error: "amount_not_positive" };
  let due = interestToToday(contract, today);
  const ahead = diffDays(today, contract.interestPaidUntil);
  if (ahead > 0) {
    const extra = interestPolicy(contract.interestType).interestFor(amount, contract.interestRate, ahead);
    due = extra.isZero() ? null : { from: today, to: contract.interestPaidUntil, amount: extra };
  }
  const settled = settleInterest(due, interest);
  if (!settled.ok) return settled;
  return { ok: true, value: { interest: settled.value, amount, outstandingAfter: contract.outstandingPrincipal.add(amount) } };
}

export type Extension = { termDaysAfter: number; interest: InterestPeriod | null };

export type ExtensionViolation = InterestSettlementViolation | "invalid_days" | "no_interest_due";

/**
 * Gia hạn (GIẢ ĐỊNH TẠM, core-spec mục 2): cộng thêm số ngày vay, không đổi tiền két. `interest` null = không thu lãi;
 * có nhập thì thu lãi theo ngày đến hôm nay (được giảm, phải > 0), ghi một dòng đóng lãi.
 */
export function planExtension(
  contract: InterestStanding & { termDays: number },
  today: LocalDate,
  extraDays: number,
  interest: Money | null,
): { ok: true; value: Extension } | { ok: false; error: ExtensionViolation } {
  if (!Number.isSafeInteger(extraDays) || extraDays < 1) return { ok: false, error: "invalid_days" };
  const termDaysAfter = contract.termDays + extraDays;
  if (interest === null) return { ok: true, value: { termDaysAfter, interest: null } };
  const due = interestToToday(contract, today);
  if (!due) return { ok: false, error: "no_interest_due" };
  const settled = settleInterest(due, interest);
  if (!settled.ok) return settled;
  return { ok: true, value: { termDaysAfter, interest: settled.value } };
}
