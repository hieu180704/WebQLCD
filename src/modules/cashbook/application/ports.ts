import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";

/** Người thực hiện thao tác, lấy từ guard (session), không bao giờ từ input của client. */
export type Actor = { userId: string; shopId: string };

/** Mọi loại giao dịch trong sổ két (data-model mục 3.6). */
export type CashTransactionType =
  | "opening_balance"
  | "capital_in"
  | "manual_income"
  | "manual_expense"
  | "disbursement"
  | "additional_loan"
  | "interest_payment"
  | "principal_repayment"
  | "installment_disbursement"
  | "installment_payment"
  | "reversal";

/** Tổng trong ngày: `opening` = mọi giao dịch trước ngày + quỹ đầu két nếu ghi đúng ngày này; `expense` mang dấu âm. */
export type CashDayTotals = { opening: Money; income: Money; expense: Money };

export type CashLine = {
  id: string;
  occurredAt: Date;
  type: CashTransactionType;
  amount: Money;
  contractCode: string | null;
  createdByName: string;
  note: string | null;
};

export type OpeningBalanceResult = "ok" | "already_set";

/** Sổ két của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface CashbookRepository {
  /** Ghi dòng `opening_balance` vào ngày mở két của cửa hàng; mỗi cửa hàng một lần. */
  recordOpeningBalance(actor: Actor, amount: Money): Promise<OpeningBalanceResult>;
  hasOpeningBalance(shopId: string): Promise<boolean>;
  dayTotals(shopId: string, date: LocalDate): Promise<CashDayTotals>;
  /** Giao dịch trong ngày, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  listDay(shopId: string, date: LocalDate, after: string | null, limit: number): Promise<CashLine[]>;
}
