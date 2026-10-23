import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { isValidRange, resolveRange, type ReportRange } from "./get-cash-report";

/** Phần hợp đồng của trang báo cáo (cầm đồ/tín chấp và trả góp). */
export type ContractReport = {
  /** Dư nợ hôm nay, không theo kỳ: hợp đồng đang mở, chưa xoá. */
  securedLending: Money;
  unsecuredLending: Money;
  /** Σ (tổng phải thu − đã thu) của hợp đồng trả góp đang góp (như ô "Còn phải thu" ở `/tra-gop`). */
  installmentRemaining: Money;
  /** Lãi cầm đồ/tín chấp từ ngày đã trả đến tới hôm nay trên gốc còn lại (như ô ở `/cam-do`). */
  accruedInterest: Money;
  /** Cầm đồ/tín chấp quá hạn đóng lãi. */
  overdue: number;
  /** Trả góp đang góp bị chậm. */
  installmentLate: number;
  /** Trong kỳ, gồm cả trả góp. Mở mới theo ngày vay / ngày bắt đầu, không tính hợp đồng đã xoá. */
  opened: number;
  /** Chuộc đồ / đóng hợp đồng / tất toán theo ngày đóng (giờ Việt Nam), không tính hợp đồng đã xoá. */
  closed: number;
  /** Theo ngày xoá (giờ Việt Nam). */
  deleted: number;
};

export interface ContractReportSource {
  /** Mọi truy vấn lọc theo `shopId` của phiên. */
  load(shopId: string, today: LocalDate, range: ReportRange): Promise<ContractReport>;
}

export class GetContractReport {
  constructor(private readonly source: ContractReportSource) {}

  /** `shopId` lấy từ session (guard), không từ input của client. Kỳ sai (từ ngày sau đến ngày) thì null. */
  async execute(shopId: string, query: { from: LocalDate | null; to: LocalDate | null }, now = new Date()): Promise<ContractReport | null> {
    const today = businessDate(now);
    const range = resolveRange(query, today);
    return isValidRange(range) ? this.source.load(shopId, today, range) : null;
  }
}
