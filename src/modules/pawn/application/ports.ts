import type { NewCustomer, ResolvedCustomer } from "@/modules/customer";
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import type { ContractKind, ContractTerms, Disbursement } from "../domain/contract";
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

/** Hợp đồng cầm đồ/tín chấp của một cửa hàng; mọi truy vấn lọc theo shopId của phiên. */
export interface ContractRepository {
  create(actor: Actor, draft: ContractDraft): Promise<CreatedContract>;
  /** Hợp đồng chưa xoá, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). */
  list(shopId: string, after: string | null, limit: number): Promise<ContractListRow[]>;
}
