import type { NewCustomer, ResolvedCustomer } from "@/modules/customer";
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type { ContractKind, ContractTerms, Disbursement, InterestPeriod, PayableStanding, Redemption } from "../domain/contract";
import type { InterestType } from "../domain/interest/interest-policy";

/** Người thực hiện thao tác, lấy từ guard (session), không bao giờ từ input của client. KTV hồ sơ = người này. */
export type Actor = { userId: string; shopId: string };

/** Hợp đồng đã qua kiểm quy tắc, sẵn sàng ghi cùng khách, sổ két và audit trong MỘT transaction. */
export type ContractDraft = {
  terms: ContractTerms;
  customer: NewCustomer;
  note: string | null;
  disbursement: Disbursement;
  /** Ngày nghiệp vụ ghi sổ két: tiền ra két hôm nay, kể cả khi ngày vay lùi về trước. */
  businessDate: LocalDate;
};

export type CreatedContract = { code: string; customer: ResolvedCustomer };

export type ContractListRow = {
  id: string;
  code: string;
  customerName: string;
  /** Đã che giữa (web-security). */
  customerPhone: string | null;
  kind: ContractKind;
  assetName: string | null;
  principal: Money;
  outstandingPrincipal: Money;
  loanDate: LocalDate;
  interestType: InterestType;
  interestRate: bigint;
  interestPeriodDays: number;
  interestPaidUntil: LocalDate;
  prepaidInterest: boolean;
  status: "active" | "closed";
};

export type ContractDetailRow = Omit<ContractListRow, "customerPhone"> & {
  termDays: number;
  note: string | null;
  staffName: string;
  /** Ngày nghiệp vụ lúc chuộc / đóng hợp đồng; null khi còn mở. */
  closedOn: LocalDate | null;
  /** Trang chi tiết hiện đủ SĐT để gọi khách; CCCD chỉ 4 số cuối (core-spec mục 2). */
  customer: { phone: string | null; address: string | null; cccdMasked: string | null };
  /** Tổng lãi đã thu, không tính lần đã bị huỷ; cộng bằng SQL. */
  interestPaid: Money;
};

/** Loại giao dịch két gắn với hợp đồng cầm đồ/tín chấp (data-model mục 3.6). */
export type ContractCashType = "disbursement" | "additional_loan" | "interest_payment" | "principal_repayment" | "reversal";

export type ContractTransaction = {
  id: string;
  occurredAt: Date;
  type: ContractCashType;
  amount: Money;
  periodFrom: LocalDate | null;
  periodTo: LocalDate | null;
  createdByName: string;
  /** Đã có bút toán đảo trỏ tới dòng này. */
  reversed: boolean;
};

export type ContractStanding = PayableStanding & { status: "active" | "closed" };

export type InterestPaymentDraft = {
  contractId: string;
  payment: InterestPeriod;
  /** Gốc còn lại lúc tính lãi; hợp đồng đã đổi gốc hoặc ngày trả đến thì không ghi (`recordInterestPayment` trả false). */
  expectedOutstanding: Money;
  businessDate: LocalDate;
};

export type RedemptionDraft = {
  contractId: string;
  redemption: Redemption;
  /** Ngày trả đến lúc tính lãi; khoá lạc quan như `InterestPaymentDraft`. */
  expectedPaidUntil: LocalDate;
  businessDate: LocalDate;
};

/** Hợp đồng cầm đồ/tín chấp của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface ContractRepository {
  create(actor: Actor, draft: ContractDraft): Promise<CreatedContract>;
  /** Hợp đồng chưa xoá, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  list(shopId: string, after: string | null, limit: number): Promise<ContractListRow[]>;
  /** Hợp đồng chưa xoá của cửa hàng, hoặc null. */
  findDetail(shopId: string, contractId: string): Promise<ContractDetailRow | null>;
  /** Giao dịch két của hợp đồng, mới nhất trước, tối đa `limit` dòng. */
  listTransactions(shopId: string, contractId: string, limit: number): Promise<ContractTransaction[]>;
  findStanding(shopId: string, contractId: string): Promise<ContractStanding | null>;
  /**
   * Ghi thu lãi, dời `interest_paid_until`, audit trong một transaction. Chỉ ghi khi hợp đồng còn mở, chưa xoá,
   * ngày trả đến bằng `payment.from` và gốc bằng `expectedOutstanding` (khoá lạc quan); không khớp thì trả false.
   */
  recordInterestPayment(actor: Actor, draft: InterestPaymentDraft): Promise<boolean>;
  /**
   * Chuộc đồ / đóng hợp đồng: ghi thu lãi (nếu có) + trả gốc chung một thao tác, gốc còn lại về 0, `status = closed`,
   * audit trong một transaction. Khoá lạc quan theo ngày trả đến và gốc (`redemption.principal`); không khớp thì trả false.
   */
  recordRedemption(actor: Actor, draft: RedemptionDraft): Promise<boolean>;
}
