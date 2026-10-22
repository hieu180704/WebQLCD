import "server-only";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { contracts, customers } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { maskPhone } from "@/shared/kernel/personal-data";
import type { CustomerDirectory, CustomerListRow, CustomerQuery, CustomerTotals } from "../application/list-customers";
import { overdueCondition } from "./contract-sql";

/** HMAC CCCD theo cửa hàng (CccdCipher.hash), ghép qua composition-root. */
export type HashCccd = (shopId: string, cccd: string) => string;

/** Tìm SĐT khi ô tìm có ít nhất chừng này chữ số. */
const MIN_PHONE_DIGITS = 3;

// Ký tự đặc biệt của LIKE trong chuỗi người dùng nhập được tìm đúng nghĩa đen (ESCAPE mặc định là \).
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

// reporting được truy vấn thẳng bảng của module khác, chỉ đọc (architecture-spec mục 2.2).
export class DrizzleCustomerDirectory implements CustomerDirectory {
  constructor(
    private readonly db: Db,
    private readonly hashCccd: HashCccd,
  ) {}

  async list(shopId: string, query: CustomerQuery, today: LocalDate, after: string | null, limit: number): Promise<CustomerListRow[]> {
    const cu = customers;
    const c = contracts;
    const open = sql`${c.status} = 'active' AND ${c.deletedAt} IS NULL`;
    const openCount = sql<number>`count(${c.id}) FILTER (WHERE ${open})`.mapWith(Number);
    const overdueCount = sql<number>`count(${c.id}) FILTER (WHERE ${open} AND ${overdueCondition(today)})`.mapWith(Number);

    const rows = await this.db
      .select({
        id: cu.id,
        fullName: cu.fullName,
        phone: cu.phone,
        address: cu.address,
        cccdMasked: cu.cccdMasked,
        openContracts: openCount,
        overdueContracts: overdueCount,
        // sum(bigint) trả numeric nên đọc dạng chuỗi.
        debt: sql<string>`coalesce(sum(${c.outstandingPrincipal}) FILTER (WHERE ${open}), 0)`,
        // Mỗi dòng của trang một truy vấn con trên index (shop_id, customer_id) và (shop_id, contract_id).
        lastActivity: sql<string | null>`(
          SELECT max(t.business_date)::text FROM cash_transactions t
          JOIN contracts k ON k.shop_id = t.shop_id AND k.id = t.contract_id
          WHERE k.shop_id = ${cu.shopId} AND k.customer_id = ${cu.id})`,
      })
      .from(cu)
      .leftJoin(c, and(eq(c.shopId, cu.shopId), eq(c.customerId, cu.id)))
      .where(and(eq(cu.shopId, shopId), after ? lt(cu.id, after) : undefined, this.matches(shopId, query)))
      .groupBy(cu.id)
      .having(query.filter === "open" ? sql`${openCount} > 0` : query.filter === "overdue" ? sql`${overdueCount} > 0` : undefined)
      .orderBy(desc(cu.id)) // uuid v7 tăng theo thời gian tạo.
      .limit(limit);
    return rows.map((row) => ({ ...row, phone: row.phone ? maskPhone(row.phone) : null, debt: Money.of(BigInt(row.debt)) }));
  }

  async totals(shopId: string): Promise<CustomerTotals> {
    const [row] = await this.db
      .select({
        customers: sql<number>`count(*)`.mapWith(Number),
        withOpenContracts: sql<number>`(
          SELECT count(DISTINCT k.customer_id) FROM contracts k
          WHERE k.shop_id = ${shopId} AND k.status = 'active' AND k.deleted_at IS NULL)`.mapWith(Number),
      })
      .from(customers)
      .where(eq(customers.shopId, shopId));
    return row;
  }

  private matches(shopId: string, query: CustomerQuery): SQL | undefined {
    const conditions: (SQL | undefined)[] = [];
    if (query.search) {
      // search_text (migration 0007) bỏ dấu + chữ thường, khớp index trigram trên search_text(full_name).
      const byName = sql`search_text(${customers.fullName}) LIKE '%' || search_text(${escapeLike(query.search)}) || '%'`;
      const digits = query.search.replace(/\D/g, "");
      conditions.push(digits.length >= MIN_PHONE_DIGITS ? or(byName, sql`${customers.phone} LIKE ${`%${digits}%`}`) : byName);
    }
    if (query.cccd) conditions.push(eq(customers.cccdHash, this.hashCccd(shopId, query.cccd)));
    return conditions.length > 0 ? and(...conditions) : undefined;
  }
}
