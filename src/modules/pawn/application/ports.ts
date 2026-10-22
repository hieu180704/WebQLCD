import type { NewCustomer, ResolvedCustomer } from "@/modules/customer";
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type {
  ContractKind,
  ContractTerms,
  Disbursement,
  Extension,
  InterestPeriod,
  OperationKind,
  PayableStanding,
  PrincipalChange,
  Redemption,
} from "../domain/contract";
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

/** Hợp đồng đang mở cần đóng lãi (trang chủ). */
export type DueContractRow = Pick<
  ContractListRow,
  | "id"
  | "code"
  | "customerName"
  | "kind"
  | "outstandingPrincipal"
  | "interestType"
  | "interestRate"
  | "interestPeriodDays"
  | "interestPaidUntil"
  | "prepaidInterest"
>;

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
  /** Tổng có dấu các dòng sổ két chưa đảo của hợp đồng; xoá hợp đồng làm két thay đổi −ledgerNet. */
  ledgerNet: Money;
  /** Hợp đồng đã xoá vẫn xem được (mockup), không còn thao tác. */
  deleted: { on: LocalDate; reason: string } | null;
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
  /** Lý do huỷ (dòng đảo). */
  note: string | null;
};

/** Thao tác mới nhất chưa huỷ của hợp đồng. */
export type LatestOperation = {
  id: string;
  kind: OperationKind;
  extraDays: number | null;
  createdAt: Date;
  createdByName: string;
  /** Tổng có dấu các dòng sổ két của thao tác; huỷ làm két thay đổi −cashNet. */
  cashNet: Money;
};

export type ReversalDraft = { contractId: string; operationId: string; reason: string; businessDate: LocalDate };

export type DeletionDraft = { contractId: string; reason: string; businessDate: LocalDate };

/** Field hồ sơ sửa được (core-spec mục 2, "Sửa"); null = để trống. */
export type EditableInfo = { assetName: string | null; note: string | null };

export type EditDraft = {
  contractId: string;
  /** Khoá lạc quan: chỉ ghi khi DB vẫn đúng giá trị này. */
  expected: EditableInfo;
  info: EditableInfo;
  changed: (keyof EditableInfo)[];
};

export type ContractStanding = PayableStanding & { status: "active" | "closed"; termDays: number; code: string };

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

export type PrincipalChangeDraft = {
  contractId: string;
  /** Trả bớt gốc (thu) hay vay thêm (chi). */
  direction: "repayment" | "additional_loan";
  change: PrincipalChange;
  /** Khoá lạc quan như `RedemptionDraft`. */
  expectedPaidUntil: LocalDate;
  expectedOutstanding: Money;
  businessDate: LocalDate;
};

export type ExtensionDraft = {
  contractId: string;
  extension: Extension;
  /** Khoá lạc quan: số ngày vay, ngày trả đến, gốc lúc mở trang. */
  expectedTermDays: number;
  expectedPaidUntil: LocalDate;
  expectedOutstanding: Money;
  businessDate: LocalDate;
};

/** Hợp đồng cầm đồ/tín chấp của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface ContractRepository {
  create(actor: Actor, draft: ContractDraft): Promise<CreatedContract>;
  /** Hợp đồng chưa xoá, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  list(shopId: string, after: string | null, limit: number): Promise<ContractListRow[]>;
  /**
   * Hợp đồng đang mở, chưa xoá, lãi suất > 0, hạn đóng lãi (`nextInterestDue`) không sau `until`; hạn sớm nhất trước,
   * tối đa `limit` dòng.
   */
  listDue(shopId: string, until: LocalDate, limit: number): Promise<DueContractRow[]>;
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
  /**
   * Trả bớt gốc / vay thêm: ghi lãi thu kèm (nếu có) + dòng gốc chung một thao tác, đặt gốc còn lại mới, dời ngày trả đến
   * tới `interest.to`, audit trong một transaction. Khoá lạc quan theo ngày trả đến và gốc; không khớp thì trả false.
   */
  recordPrincipalChange(actor: Actor, draft: PrincipalChangeDraft): Promise<boolean>;
  /** Gia hạn: đổi số ngày vay, ghi lãi thu kèm (nếu có), audit trong một transaction. Khoá lạc quan như trên. */
  recordExtension(actor: Actor, draft: ExtensionDraft): Promise<boolean>;
  /** Thao tác mới nhất chưa huỷ của hợp đồng chưa xoá, hoặc null. */
  findLatestOperation(shopId: string, contractId: string): Promise<LatestOperation | null>;
  /**
   * Huỷ thao tác: đánh dấu đã huỷ, đảo mọi dòng sổ két chung id, tính lại gốc còn lại / ngày trả đến từ các dòng chưa đảo
   * (data-model mục 4), trừ số ngày gia hạn, mở lại hợp đồng nếu huỷ chuộc; audit; một transaction. Chỉ ghi khi
   * `operationId` vẫn là thao tác mới nhất chưa huỷ và không phải giải ngân; không thì trả false.
   */
  reverseOperation(actor: Actor, draft: ReversalDraft): Promise<boolean>;
  /** Xoá mềm hợp đồng chưa xoá kèm lý do, đảo mọi dòng sổ két chưa đảo trong một thao tác, audit; không thấy thì false. */
  deleteContract(actor: Actor, draft: DeletionDraft): Promise<boolean>;
  /** Sửa thông tin hồ sơ của hợp đồng chưa xoá + audit `edit`; giá trị trong DB khác `expected` thì trả false. */
  recordEdit(actor: Actor, draft: EditDraft): Promise<boolean>;
}
