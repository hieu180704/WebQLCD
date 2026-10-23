import type { ContractCashType } from "@/modules/pawn";
import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";

/** Số giao dịch két gần nhất hiện ở trang chi tiết khách. */
export const CUSTOMER_RECENT_TRANSACTIONS = 20;

export type CustomerSummary = {
  id: string;
  fullName: string;
  /** Trang chi tiết hiện đủ SĐT để gọi khách (như chi tiết hợp đồng); CCCD chỉ 4 số cuối. */
  phone: string | null;
  address: string | null;
  cccdMasked: string | null;
  createdAt: Date;
  /** Hợp đồng đang mở, chưa xoá: cầm đồ/tín chấp + trả góp đang góp. */
  openContracts: number;
  /** Quá hạn đóng lãi + chậm góp. */
  overdueContracts: number;
  /** Σ gốc còn lại của hợp đồng cầm đồ/tín chấp đang mở + Σ còn phải thu của hợp đồng trả góp đang góp. */
  debt: Money;
  /** Σ lãi đã thu trên mọi hợp đồng của khách, không tính dòng đã bị đảo. */
  interestPaid: Money;
};

export type CustomerContractRow = CustomerPawnRow | CustomerInstallmentRow;

export type CustomerPawnRow = {
  type: "pawn";
  id: string;
  code: string;
  kind: "secured" | "unsecured";
  assetName: string | null;
  principal: Money;
  outstandingPrincipal: Money;
  loanDate: LocalDate;
  /** Hạn đóng lãi kế tiếp; null khi đã đóng hoặc đã xoá. */
  nextInterestDue: LocalDate | null;
  /** Ngày nghiệp vụ lúc chuộc / đóng hợp đồng. */
  closedOn: LocalDate | null;
  deleted: boolean;
};

export type CustomerInstallmentRow = {
  type: "installment";
  id: string;
  code: string;
  amountGiven: Money;
  /** Tổng phải thu − đã thu khi đang góp; 0 khi đã đóng hoặc đã xoá. */
  remaining: Money;
  startDate: LocalDate;
  /** Nhãn hạn góp khi đang góp, chưa xoá (hàm SQL installment_late / installment_due_today); null khi đã đóng hoặc đã xoá. */
  dueStatus: "late" | "today" | "on_time" | null;
  closedOn: LocalDate | null;
  deleted: boolean;
};

/** Loại giao dịch két gắn hợp đồng: của cầm đồ/tín chấp hoặc trả góp. */
export type CustomerCashType = ContractCashType | "installment_disbursement" | "installment_payment";

export type CustomerTransactionRow = {
  id: string;
  occurredAt: Date;
  contractCode: string;
  type: CustomerCashType;
  amount: Money;
  periodFrom: LocalDate | null;
  periodTo: LocalDate | null;
  note: string | null;
  reversed: boolean;
};

export interface CustomerProfileSource {
  /** null khi khách không thuộc cửa hàng. Quá hạn tính tới `today`. */
  findCustomer(
    shopId: string,
    customerId: string,
    today: LocalDate,
  ): Promise<CustomerSummary | null>;
  /** Mọi hợp đồng của khách (cầm đồ/tín chấp và trả góp), kể cả đã xoá, mới nhất trước. */
  /** Nhãn hạn góp tính tới `today`. */
  listContracts(
    shopId: string,
    customerId: string,
    today: LocalDate,
  ): Promise<CustomerContractRow[]>;
  /** Giao dịch két của mọi hợp đồng của khách (cả trả góp), mới nhất trước. */
  recentTransactions(
    shopId: string,
    customerId: string,
    limit: number,
  ): Promise<CustomerTransactionRow[]>;
}

export type CustomerDetailView = {
  customer: CustomerSummary;
  /** Ngày nghiệp vụ lúc tạo khách; trang hiện tháng/năm. */
  since: LocalDate;
  contracts: CustomerContractRow[];
  transactions: CustomerTransactionRow[];
  today: LocalDate;
};

export class GetCustomerDetail {
  constructor(private readonly source: CustomerProfileSource) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(
    shopId: string,
    customerId: string,
    now = new Date(),
  ): Promise<CustomerDetailView | null> {
    const today = businessDate(now);
    const [customer, contracts, transactions] = await Promise.all([
      this.source.findCustomer(shopId, customerId, today),
      this.source.listContracts(shopId, customerId, today),
      this.source.recentTransactions(
        shopId,
        customerId,
        CUSTOMER_RECENT_TRANSACTIONS,
      ),
    ]);
    if (!customer) return null;
    return {
      customer,
      since: businessDate(customer.createdAt),
      contracts,
      transactions,
      today,
    };
  }
}
