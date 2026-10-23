import "server-only";
import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { cashTransactions, shops } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type { CashDayRaw, CashReportSource, CashTypeTotal, ReportRange } from "../application/get-cash-report";

// reporting được truy vấn thẳng bảng của module khác, chỉ đọc (architecture-spec mục 2.2).
// Mọi truy vấn chạy trên index (shop_id, business_date). sum(bigint) trả numeric nên đọc dạng chuỗi.
const t = cashTransactions;
const toMoney = (value: string) => Money.of(BigInt(value));

export class DrizzleCashReport implements CashReportSource {
  constructor(private readonly db: Db) {}

  async openedAt(shopId: string): Promise<LocalDate> {
    const [row] = await this.db.select({ openedAt: shops.openedAt }).from(shops).where(eq(shops.id, shopId));
    return row.openedAt;
  }

  async totals(shopId: string, range: ReportRange): Promise<{ before: Money; byType: CashTypeTotal[] }> {
    const before = this.db
      .select({ total: sql<string>`coalesce(sum(${t.amount}), 0)` })
      .from(t)
      .where(and(eq(t.shopId, shopId), lt(t.businessDate, range.from)));
    const byType = this.db
      .select({
        type: t.type,
        count: sql<number>`count(*)`.mapWith(Number),
        income: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.amount} > 0), 0)`,
        expense: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.amount} < 0), 0)`,
      })
      .from(t)
      .where(and(eq(t.shopId, shopId), gte(t.businessDate, range.from), lte(t.businessDate, range.to)))
      .groupBy(t.type);

    const [[sum], rows] = await Promise.all([before, byType]);
    return {
      before: toMoney(sum.total),
      byType: rows.map((row) => ({ type: row.type, count: row.count, income: toMoney(row.income), expense: toMoney(row.expense) })),
    };
  }

  async days(shopId: string, range: ReportRange, before: LocalDate | null, limit: number): Promise<CashDayRaw[]> {
    // Cộng dồn trên mọi ngày của kỳ rồi mới cắt trang, để trang sau vẫn có số cộng dồn từ đầu kỳ.
    const daily = this.db
      .select({
        date: t.businessDate,
        // Thu không tính quỹ đầu két, như sổ quỹ (cashbook dayTotals).
        income: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.amount} > 0 AND ${t.type} <> 'opening_balance'), 0)`.as("income"),
        expense: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.amount} < 0), 0)`.as("expense"),
        running: sql<string>`sum(sum(${t.amount})) OVER (ORDER BY ${t.businessDate})`.as("running"),
      })
      .from(t)
      .where(and(eq(t.shopId, shopId), gte(t.businessDate, range.from), lte(t.businessDate, range.to)))
      .groupBy(t.businessDate)
      .as("daily");
    const rows = await this.db
      .select({ date: daily.date, income: daily.income, expense: daily.expense, running: daily.running })
      .from(daily)
      .where(before ? lt(daily.date, before) : undefined)
      .orderBy(desc(daily.date))
      .limit(limit);
    return rows.map((row) => ({
      date: row.date,
      income: toMoney(row.income),
      expense: toMoney(row.expense),
      running: toMoney(row.running),
    }));
  }
}
