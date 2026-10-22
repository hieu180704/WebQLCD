import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";

export const CUSTOMER_PAGE_SIZE = 50;

/** Lọc theo hợp đồng cầm đồ/tín chấp đang mở, chưa xoá (chưa tính trả góp). */
export type CustomerFilter = "open" | "overdue";

/** `search`: tên (không dấu, không phân biệt hoa thường) hoặc SĐT; `cccd`: đã chuẩn hoá, khớp đủ số qua hash. */
export type CustomerQuery = { search: string | null; cccd: string | null; filter: CustomerFilter | null };

export type CustomerListRow = {
  id: string;
  fullName: string;
  /** Đã che giữa (web-security). */
  phone: string | null;
  address: string | null;
  /** Chỉ 4 số cuối; null = chưa có CCCD. */
  cccdMasked: string | null;
  openContracts: number;
  overdueContracts: number;
  /** Σ gốc còn lại của hợp đồng đang mở. */
  debt: Money;
  /** Ngày nghiệp vụ của giao dịch két gần nhất thuộc hợp đồng của khách. */
  lastActivity: LocalDate | null;
};

export type CustomerTotals = { customers: number; withOpenContracts: number };

export interface CustomerDirectory {
  /** Khách của cửa hàng, mới nhất trước; `after` là id dòng cuối của trang trước (keyset). Quá hạn tính tới `today`. */
  list(shopId: string, query: CustomerQuery, today: LocalDate, after: string | null, limit: number): Promise<CustomerListRow[]>;
  totals(shopId: string): Promise<CustomerTotals>;
}

export type CustomerListView = { items: CustomerListRow[]; nextAfter: string | null; totals: CustomerTotals };

export class ListCustomers {
  constructor(private readonly directory: CustomerDirectory) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, query: CustomerQuery, after: string | null, now = new Date()): Promise<CustomerListView> {
    const [rows, totals] = await Promise.all([
      this.directory.list(shopId, query, businessDate(now), after, CUSTOMER_PAGE_SIZE + 1),
      this.directory.totals(shopId),
    ]);
    const hasMore = rows.length > CUSTOMER_PAGE_SIZE;
    const items = hasMore ? rows.slice(0, CUSTOMER_PAGE_SIZE) : rows;
    return { items, nextAfter: hasMore ? items[items.length - 1].id : null, totals };
  }
}
