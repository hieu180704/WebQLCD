import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import {
  cashTransactions,
  contracts,
  customers,
} from "@/shared/infrastructure/db/schema";
import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type {
  CustomerContractRow,
  CustomerProfileSource,
  CustomerSummary,
  CustomerTransactionRow,
} from "../application/get-customer-detail";
import { overdueCondition } from "./contract-sql";

// reporting được truy vấn thẳng bảng của module khác, chỉ đọc (architecture-spec mục 2.2).
export class DrizzleCustomerProfile implements CustomerProfileSource {
  constructor(private readonly db: Db) {}

  async findCustomer(
    shopId: string,
    customerId: string,
    today: LocalDate,
  ): Promise<CustomerSummary | null> {
    const cu = customers;
    const c = contracts;
    const open = sql`${c.status} = 'active' AND ${c.deletedAt} IS NULL`;
    const [row] = await this.db
      .select({
        id: cu.id,
        fullName: cu.fullName,
        phone: cu.phone,
        address: cu.address,
        cccdMasked: cu.cccdMasked,
        createdAt: cu.createdAt,
        openContracts:
          sql<number>`count(${c.id}) FILTER (WHERE ${open})`.mapWith(Number),
        overdueContracts:
          sql<number>`count(${c.id}) FILTER (WHERE ${open} AND ${overdueCondition(today)})`.mapWith(
            Number,
          ),
        // sum(bigint) trả numeric nên đọc dạng chuỗi.
        debt: sql<string>`coalesce(sum(${c.outstandingPrincipal}) FILTER (WHERE ${open}), 0)`,
        // Lãi đã thu trừ dòng đã bị đảo (hợp đồng đã xoá thì mọi dòng đã đảo); index (shop_id, customer_id), UNIQUE (reverses_id).
        interestPaid: sql<string>`coalesce((
          SELECT sum(t.amount) FROM cash_transactions t
          JOIN contracts k ON k.shop_id = t.shop_id AND k.id = t.contract_id
          WHERE k.shop_id = ${cu.shopId} AND k.customer_id = ${cu.id} AND t.type = 'interest_payment'
            AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id)
        ), 0)`,
      })
      .from(cu)
      .leftJoin(c, and(eq(c.shopId, cu.shopId), eq(c.customerId, cu.id)))
      .where(and(eq(cu.shopId, shopId), eq(cu.id, customerId)))
      .groupBy(cu.id);
    if (!row) return null;
    return {
      ...row,
      debt: Money.of(BigInt(row.debt)),
      interestPaid: Money.of(BigInt(row.interestPaid)),
    };
  }

  async listContracts(
    shopId: string,
    customerId: string,
  ): Promise<CustomerContractRow[]> {
    const c = contracts;
    const rows = await this.db
      .select({
        id: c.id,
        code: c.code,
        kind: c.kind,
        assetName: c.assetName,
        principal: c.principal,
        outstandingPrincipal: c.outstandingPrincipal,
        loanDate: c.loanDate,
        // Hàm SQL contract_interest_due (migration 0007) tính như `nextInterestDue` của pawn.
        nextInterestDue: sql<
          string | null
        >`CASE WHEN ${c.status} = 'active' AND ${c.deletedAt} IS NULL
          THEN contract_interest_due(${c.interestPaidUntil}, ${c.prepaidInterest}, ${c.interestPeriodDays})::text END`,
        closedAt: c.closedAt,
        deletedAt: c.deletedAt,
      })
      .from(c)
      .where(and(eq(c.shopId, shopId), eq(c.customerId, customerId)))
      .orderBy(desc(c.id)); // uuid v7 tăng theo thời gian tạo.
    return rows.map(({ closedAt, deletedAt, ...row }) => ({
      ...row,
      principal: Money.of(row.principal),
      outstandingPrincipal: Money.of(row.outstandingPrincipal),
      closedOn: closedAt ? businessDate(closedAt) : null,
      deleted: deletedAt !== null,
    }));
  }

  async recentTransactions(
    shopId: string,
    customerId: string,
    limit: number,
  ): Promise<CustomerTransactionRow[]> {
    const t = cashTransactions;
    const c = contracts;
    const rows = await this.db
      .select({
        id: t.id,
        occurredAt: t.occurredAt,
        contractCode: c.code,
        type: t.type,
        amount: t.amount,
        periodFrom: t.periodFrom,
        periodTo: t.periodTo,
        note: t.note,
        reversed: sql<boolean>`EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = ${t.id})`,
      })
      .from(t)
      .innerJoin(c, and(eq(c.shopId, t.shopId), eq(c.id, t.contractId)))
      .where(and(eq(c.shopId, shopId), eq(c.customerId, customerId)))
      .orderBy(desc(t.occurredAt), desc(t.id))
      .limit(limit);
    // Dòng có contract_id chỉ mang type của hợp đồng (CHECK cash_transactions_type_rules).
    return rows.map((row) => ({
      ...row,
      type: row.type as CustomerTransactionRow["type"],
      amount: Money.of(row.amount),
    }));
  }
}
