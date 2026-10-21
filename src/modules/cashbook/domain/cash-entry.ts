import type { LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";

/** Loại giao dịch két đang dùng. Dấu tiền theo bảng data-model mục 3.6. */
export type CashEntryType = "opening_balance" | "disbursement" | "additional_loan" | "interest_payment" | "principal_repayment";

/** Bút toán chờ ghi; `amount` là độ lớn (dương), dấu do `signedAmount` áp theo loại. */
export type CashEntry =
  | { type: "opening_balance"; amount: Money }
  | { type: "disbursement"; contractId: string; amount: Money }
  | { type: "additional_loan"; contractId: string; amount: Money }
  | { type: "interest_payment"; contractId: string; amount: Money; periodFrom: LocalDate; periodTo: LocalDate }
  | { type: "principal_repayment"; contractId: string; amount: Money };

const OUTFLOW: ReadonlySet<CashEntryType> = new Set(["disbursement", "additional_loan"]);

/** Số tiền có dấu ghi sổ: + thu vào két, − chi ra két. Độ lớn phải dương (sổ két cấm amount = 0). */
export function signedAmount(entry: CashEntry): Money {
  if (!entry.amount.isPositive()) throw new RangeError(`Bút toán ${entry.type} cần số tiền dương`);
  return OUTFLOW.has(entry.type) ? entry.amount.negate() : entry.amount;
}

export type CashDaySummary = { opening: Money; income: Money; expense: Money; closing: Money };

/** Số tiền cuối ngày = Quỹ đầu két − Tổng chi + Tổng thu (core-spec mục 2); `expense` mang dấu âm. */
export function summarizeDay(opening: Money, income: Money, expense: Money): CashDaySummary {
  return { opening, income, expense, closing: opening.add(income).add(expense) };
}
