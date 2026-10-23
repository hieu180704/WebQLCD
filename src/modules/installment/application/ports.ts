import type { NewCustomer, ResolvedCustomer } from "@/modules/customer";
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type { InstallmentStanding, InstallmentTerms, OperationKind, Payment } from "../domain/installment";

/** Người thực hiện thao tác, lấy từ guard (session), không bao giờ từ input của client. KTV hồ sơ = người này. */
export type Actor = { userId: string; shopId: string };

/** Hợp đồng đã qua kiểm quy tắc, sẵn sàng ghi cùng khách, sổ két và audit trong MỘT transaction. */
export type InstallmentDraft = {
  terms: InstallmentTerms;
  customer: NewCustomer;
  note: string | null;
  /** Ngày nghiệp vụ ghi sổ két: tiền ra két hôm nay, kể cả khi ngày bắt đầu lùi về trước. */
  businessDate: LocalDate;
};

export type CreatedInstallment = { code: string; customer: ResolvedCustomer };

export type InstallmentListRow = {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  /** Đã che giữa (web-security). */
  customerPhone: string | null;
  amountGiven: Money;
  totalDue: Money;
  amountPaid: Money;
  totalDays: number;
  periodDays: number;
  startDate: LocalDate;
  status: "active" | "closed";
  deleted: boolean;
};

export type InstallmentDetailRow = Omit<InstallmentListRow, "customerPhone" | "deleted"> & {
  note: string | null;
  staffName: string;
  /** Ngày nghiệp vụ lúc đóng hợp đồng; null khi còn góp. */
  closedOn: LocalDate | null;
  /** Trang chi tiết hiện đủ SĐT để gọi khách; CCCD chỉ 4 số cuối (core-spec mục 2). */
  customer: { phone: string | null; address: string | null; cccdMasked: string | null };
  /** Tổng có dấu các dòng sổ két chưa đảo của hợp đồng; xoá hợp đồng làm két thay đổi −ledgerNet. */
  ledgerNet: Money;
  /** Hợp đồng đã xoá vẫn xem được (mockup), không còn thao tác. */
  deleted: { on: LocalDate; reason: string } | null;
};

/** Loại giao dịch két gắn với hợp đồng trả góp (data-model mục 3.6). */
export type InstallmentCashType = "installment_disbursement" | "installment_payment" | "reversal";

export type InstallmentTransaction = {
  id: string;
  occurredAt: Date;
  type: InstallmentCashType;
  amount: Money;
  /** Thao tác sinh ra dòng này; null với dòng đảo khi xoá hợp đồng (không thuộc thao tác nào). */
  operationKind: OperationKind | null;
  createdByName: string;
  /** Đã có bút toán đảo trỏ tới dòng này. */
  reversed: boolean;
  /** Lý do huỷ (dòng đảo). */
  note: string | null;
};

/** Một lần thu chưa bị huỷ (tính lịch góp, nhãn "Góp kỳ ..."). */
export type PaymentRecord = { id: string; on: LocalDate; amount: Money };

export type InstallmentRecord = InstallmentStanding & { code: string; status: "active" | "closed" };

export type PaymentDraft = {
  contractId: string;
  /** `pay` = đóng tiền góp (thu đủ thì tự đóng hợp đồng); `close` = đóng / tất toán. */
  kind: "pay" | "close";
  payment: Payment;
  /** Số đã thu lúc tính; DB khác thì không ghi (khoá lạc quan, `recordPayment` trả false). */
  expectedPaid: Money;
  businessDate: LocalDate;
};

/** Hợp đồng trả góp của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface InstallmentRepository {
  create(actor: Actor, draft: InstallmentDraft): Promise<CreatedInstallment>;
  /** Hợp đồng chưa xoá, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  list(shopId: string, after: string | null, limit: number): Promise<InstallmentListRow[]>;
  /** Hợp đồng của cửa hàng kể cả đã xoá, hoặc null. */
  findDetail(shopId: string, contractId: string): Promise<InstallmentDetailRow | null>;
  /** Giao dịch két của hợp đồng, mới nhất trước, tối đa `limit` dòng. */
  listTransactions(shopId: string, contractId: string, limit: number): Promise<InstallmentTransaction[]>;
  /** Mọi lần thu chưa bị huỷ của hợp đồng, cũ trước. */
  listPayments(shopId: string, contractId: string): Promise<PaymentRecord[]>;
  /** Hợp đồng chưa xoá của cửa hàng, hoặc null. */
  findRecord(shopId: string, contractId: string): Promise<InstallmentRecord | null>;
  /**
   * Ghi thu (bỏ dòng sổ két khi số tiền 0), cộng `amount_paid`, đóng hợp đồng khi `payment.closes`, ghi thao tác và audit trong
   * một transaction. Chỉ ghi khi hợp đồng còn góp, chưa xoá và `amount_paid` bằng `expectedPaid`; không thì trả false.
   */
  recordPayment(actor: Actor, draft: PaymentDraft): Promise<boolean>;
}
