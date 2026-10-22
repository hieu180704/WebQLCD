import "server-only";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/shared/infrastructure/db/client";
import { cashTransactions, contracts } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type { DashboardStats, DashboardStatsSource, MonthRange } from "../application/get-dashboard-stats";
import { overdueCondition } from "./contract-sql";

// reporting được truy vấn thẳng bảng của module khác, chỉ đọc (architecture-spec mục 2.2).
const original = alias(cashTransactions, "original");

export class DrizzleDashboardStats implements DashboardStatsSource {
  constructor(private readonly db: Db) {}

  async load(shopId: string, today: LocalDate, month: MonthRange): Promise<DashboardStats> {
    const c = contracts;
    const overdue = overdueCondition(today);
    const contractStats = this.db
      .select({
        // sum(bigint) trả numeric nên đọc dạng chuỗi.
        lending: sql<string>`coalesce(sum(${c.outstandingPrincipal}), 0)`,
        openSecured: sql<number>`count(*) FILTER (WHERE ${c.kind} = 'secured')`.mapWith(Number),
        openUnsecured: sql<number>`count(*) FILTER (WHERE ${c.kind} = 'unsecured')`.mapWith(Number),
        overdue: sql<number>`count(*) FILTER (WHERE ${overdue})`.mapWith(Number),
      })
      .from(c)
      .where(and(eq(c.shopId, shopId), eq(c.status, "active"), isNull(c.deletedAt)));

    // Dòng lãi + dòng đảo của dòng lãi, cùng ghi trong tháng; trên index (shop_id, business_date).
    const t = cashTransactions;
    const interest = this.db
      .select({ total: sql<string>`coalesce(sum(${t.amount}), 0)` })
      .from(t)
      .leftJoin(original, and(eq(original.shopId, t.shopId), eq(original.id, t.reversesId)))
      .where(
        and(
          eq(t.shopId, shopId),
          gte(t.businessDate, month.from),
          lt(t.businessDate, month.to),
          or(eq(t.type, "interest_payment"), and(eq(t.type, "reversal"), eq(original.type, "interest_payment"))),
        ),
      );

    const [[stats], [income]] = await Promise.all([contractStats, interest]);
    return {
      lending: Money.of(BigInt(stats.lending)),
      openSecured: stats.openSecured,
      openUnsecured: stats.openUnsecured,
      interestThisMonth: Money.of(BigInt(income.total)),
      overdue: stats.overdue,
    };
  }
}
