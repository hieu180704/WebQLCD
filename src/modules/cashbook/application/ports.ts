import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type { ManualEntryType } from "../domain/cash-entry";

export type { ManualEntryType };

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
  contractId: string | null;
  contractCode: string | null;
  createdByName: string;
  /** Nội dung phiếu; với dòng đảo là lý do huỷ. */
  note: string | null;
  /** Dòng này đã bị một dòng đảo huỷ. */
  reversed: boolean;
  /** Dòng đảo: loại và giờ của dòng gốc bị huỷ. */
  reverses: { type: CashTransactionType; occurredAt: Date } | null;
};

export type OpeningBalanceResult = "ok" | "already_set";

/** `amount` là độ lớn (dương); `note` là nội dung phiếu. */
export type ManualEntry = { type: ManualEntryType; amount: Money; note: string | null };

/** Người thực hiện giao dịch (chủ tiệm + KTV) cho bộ lọc sổ quỹ. */
export type CashActor = { id: string; name: string };

/** Điều kiện lọc đã quy về loại cụ thể. */
export type CashLineQuery = { types: readonly CashTransactionType[] | null; createdBy: string | null };

export type ReverseManualResult = "ok" | "not_found" | "not_manual" | "already_reversed";

/** Sổ két của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface CashbookRepository {
  /** Ghi dòng `opening_balance` vào ngày mở két của cửa hàng; mỗi cửa hàng một lần. */
  recordOpeningBalance(actor: Actor, amount: Money): Promise<OpeningBalanceResult>;
  /** Ghi một phiếu vào sổ két ngày `date` kèm nhật ký, cùng một transaction. */
  recordManualEntry(actor: Actor, entry: ManualEntry, date: LocalDate): Promise<void>;
  /** Ghi bút toán đảo phiếu `transactionId` vào ngày `date`, `reason` vào `note`, kèm nhật ký, cùng một transaction. */
  reverseManualEntry(actor: Actor, transactionId: string, reason: string, date: LocalDate): Promise<ReverseManualResult>;
  hasOpeningBalance(shopId: string): Promise<boolean>;
  dayTotals(shopId: string, date: LocalDate): Promise<CashDayTotals>;
  /** Giao dịch trong ngày, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  listDay(shopId: string, date: LocalDate, query: CashLineQuery, after: string | null, limit: number): Promise<CashLine[]>;
  /** Mọi tài khoản của cửa hàng (kể cả đã khoá), chủ tiệm trước. */
  listActors(shopId: string): Promise<CashActor[]>;
}
