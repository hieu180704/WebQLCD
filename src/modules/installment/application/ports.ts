import type { NewCustomer, ResolvedCustomer } from "@/modules/customer";
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type { InstallmentTerms } from "../domain/installment";

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

/** Hợp đồng trả góp của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface InstallmentRepository {
  create(actor: Actor, draft: InstallmentDraft): Promise<CreatedInstallment>;
  /** Hợp đồng chưa xoá, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  list(shopId: string, after: string | null, limit: number): Promise<InstallmentListRow[]>;
}
