import "server-only";
import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/shared/infrastructure/db/client";
import { contracts } from "@/shared/infrastructure/db/schema";
import { addDays, BUSINESS_TIME_ZONE, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type { ContractReport, ContractReportSource } from "../application/get-contract-report";
import type { ReportRange } from "../application/get-cash-report";
import { overdueCondition } from "./contract-sql";

// reporting được truy vấn thẳng bảng của module khác, chỉ đọc (architecture-spec mục 2.2).
const c = contracts;

/** Mốc thời gian (timestamptz) rơi vào kỳ theo ngày giờ Việt Nam; nửa mở [from 00:00, to + 1 00:00). */
const inRange = (column: AnyPgColumn, range: ReportRange) =>
  sql`(${column} >= (${range.from}::date::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE})
    AND ${column} < (${addDays(range.to, 1)}::date::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE}))`;

export class DrizzleContractReport implements ContractReportSource {
  constructor(private readonly db: Db) {}

  async load(shopId: string, today: LocalDate, range: ReportRange): Promise<ContractReport> {
    // Một lượt quét hợp đồng của cửa hàng (index bắt đầu bằng shop_id); sum(bigint) trả numeric nên đọc dạng chuỗi.
    const open = sql`${c.status} = 'active' AND ${c.deletedAt} IS NULL`;
    const live = sql`${c.deletedAt} IS NULL`;
    const [row] = await this.db
      .select({
        secured: sql<string>`coalesce(sum(${c.outstandingPrincipal}) FILTER (WHERE ${open} AND ${c.kind} = 'secured'), 0)`,
        unsecured: sql<string>`coalesce(sum(${c.outstandingPrincipal}) FILTER (WHERE ${open} AND ${c.kind} = 'unsecured'), 0)`,
        // Hàm SQL contract_accrued_interest (migration 0009) tính như `accruedInterest` của pawn.
        accrued: sql<string>`coalesce(sum(contract_accrued_interest(${c.interestType}, ${c.outstandingPrincipal}, ${c.interestRate}, ${c.interestPaidUntil}, ${today})) FILTER (WHERE ${open}), 0)`,
        overdue: sql<number>`count(*) FILTER (WHERE ${open} AND ${overdueCondition(today)})`.mapWith(Number),
        opened: sql<number>`count(*) FILTER (WHERE ${live} AND ${c.loanDate} BETWEEN ${range.from} AND ${range.to})`.mapWith(Number),
        closed: sql<number>`count(*) FILTER (WHERE ${live} AND ${inRange(c.closedAt, range)})`.mapWith(Number),
        deleted: sql<number>`count(*) FILTER (WHERE ${inRange(c.deletedAt, range)})`.mapWith(Number),
      })
      .from(c)
      .where(eq(c.shopId, shopId));
    return {
      securedLending: Money.of(BigInt(row.secured)),
      unsecuredLending: Money.of(BigInt(row.unsecured)),
      accruedInterest: Money.of(BigInt(row.accrued)),
      overdue: row.overdue,
      opened: row.opened,
      closed: row.closed,
      deleted: row.deleted,
    };
  }
}
