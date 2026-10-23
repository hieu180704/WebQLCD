import type { NewCustomer, ResolvedCustomer } from "@/modules/customer";
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type { InstallmentStanding, InstallmentTerms, OperationKind, Payment } from "../domain/installment";

/** Người thực hiện thao tác, lấy từ guard (session), không bao giờ từ input của client. KTV hồ sơ = người này. */
export type Actor = { userId: string; shopId: string };

/** Khách nhập mới, hoặc khách có sẵn khi mở form từ trang khách (repository kiểm khách thuộc cửa hàng). */
export type InstallmentCustomer = NewCustomer | { existingId: string };

/** Khách có sẵn hiện trên form tạo hợp đồng mở từ trang khách; CCCD đã che. */
export type CustomerSummary = { id: string; fullName: string; phone: string | null; cccdMasked: string | null };

/** Hợp đồng đã qua kiểm quy tắc, sẵn sàng ghi cùng khách, sổ két và audit trong MỘT transaction. */
export type InstallmentDraft = {
  terms: InstallmentTerms;
  customer: InstallmentCustomer;
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
  /** Chỉ 4 số cuối (cột `cccd_masked`). */
  customerCccdMasked: string | null;
  amountGiven: Money;
  totalDue: Money;
  amountPaid: Money;
  totalDays: number;
  periodDays: number;
  startDate: LocalDate;
  status: "active" | "closed";
  deleted: boolean;
};

export type InstallmentDetailRow = Omit<InstallmentListRow, "customerPhone" | "customerCccdMasked" | "deleted"> & {
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

/** Thao tác mới nhất chưa huỷ của hợp đồng. */
export type LatestOperation = {
  id: string;
  kind: OperationKind;
  createdAt: Date;
  createdByName: string;
  /** Tổng có dấu các dòng sổ két của thao tác; huỷ làm két thay đổi −cashNet. */
  cashNet: Money;
};

export type ReversalDraft = { contractId: string; operationId: string; reason: string; businessDate: LocalDate };

export type DeletionDraft = { contractId: string; reason: string; businessDate: LocalDate };

/**
 * Trạng thái lọc danh sách (core-spec mục 2). "Chậm góp", "Đến hạn hôm nay" như nhãn hạn góp; chỉ hợp đồng đang góp.
 * `due_soon` = kỳ tới hạn không sau hôm nay + DUE_WINDOW_DAYS, gồm cả chậm góp (như bảng đến hạn ở trang chủ).
 */
export type InstallmentStatusFilter = "open" | "late" | "due_today" | "due_soon" | "closed" | "deleted";

/** `search`: mã HĐ, tên khách (không dấu), SĐT; `cccd`: đã chuẩn hoá, khớp đủ số qua hash. */
export type InstallmentFilter = {
  search: string | null;
  cccd: string | null;
  /** null = mọi hợp đồng chưa xoá. */
  status: InstallmentStatusFilter | null;
};

/** Ô thống kê đầu trang danh sách, của cả cửa hàng (không theo bộ lọc). */
export type InstallmentStats = {
  /** Số hợp đồng đang góp, chưa xoá. */
  openCount: number;
  /** Tổng tiền đưa khách của hợp đồng đang góp. */
  givenOpen: Money;
  /** Tổng (tổng phải thu − đã thu) của hợp đồng đang góp. */
  remainingOpen: Money;
  /** Dòng thu trả góp ghi trong tháng trừ dòng huỷ thu trả góp ghi trong tháng (theo ngày nghiệp vụ). */
  collectedThisMonth: Money;
  /** Số hợp đồng đang chậm góp. */
  lateCount: number;
};

/** Hợp đồng đang góp có kỳ tới đến hạn (bảng đến hạn trang chủ). */
export type DueInstallmentRow = InstallmentStanding & { id: string; code: string; customerName: string };

/** Hợp đồng trả góp của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface InstallmentRepository {
  /** Khách có sẵn không thuộc cửa hàng thì không ghi gì, trả "customer_not_found". */
  create(actor: Actor, draft: InstallmentDraft): Promise<CreatedInstallment | "customer_not_found">;
  /** Khách của cửa hàng, hoặc null. */
  findCustomerSummary(shopId: string, customerId: string): Promise<CustomerSummary | null>;
  /** Hợp đồng khớp bộ lọc, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). Hạn tính tới `today`. */
  list(shopId: string, filter: InstallmentFilter, today: LocalDate, after: string | null, limit: number): Promise<InstallmentListRow[]>;
  /** Thống kê cả cửa hàng; tháng = [monthStart, nextMonthStart) theo ngày nghiệp vụ. */
  stats(shopId: string, today: LocalDate, monthStart: LocalDate, nextMonthStart: LocalDate): Promise<InstallmentStats>;
  /** Hợp đồng đang góp, chưa xoá, hạn kỳ tới ≤ `until` (kể cả chậm góp), hạn sớm nhất trước. */
  listDue(shopId: string, until: LocalDate, limit: number): Promise<DueInstallmentRow[]>;
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
  /** Thao tác mới nhất chưa huỷ của hợp đồng chưa xoá, hoặc null. */
  findLatestOperation(shopId: string, contractId: string): Promise<LatestOperation | null>;
  /**
   * Huỷ thao tác: đánh dấu đã huỷ, đảo mọi dòng sổ két chung id, tính lại `amount_paid` từ các lần thu chưa đảo (data-model
   * mục 4), mở lại hợp đồng (thao tác mới nhất của hợp đồng đã đóng luôn là lần đóng); audit; một transaction. Chỉ ghi khi
   * `operationId` vẫn là thao tác mới nhất chưa huỷ và không phải giải ngân; không thì trả false.
   */
  reverseOperation(actor: Actor, draft: ReversalDraft): Promise<boolean>;
  /** Xoá mềm hợp đồng chưa xoá kèm lý do, đảo mọi dòng sổ két chưa đảo trong một thao tác, audit; không thấy thì false. */
  deleteContract(actor: Actor, draft: DeletionDraft): Promise<boolean>;
}
