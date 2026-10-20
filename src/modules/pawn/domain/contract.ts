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
