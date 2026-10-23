import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type { Db } from "@/shared/infrastructure/db/client";
import {
  cashTransactions,
  contracts,
  customers,
  installmentContracts,
} from "@/shared/infrastructure/db/schema";
import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type {
  CustomerCashType,
  CustomerContractRow,
  CustomerInstallmentRow,
  CustomerProfileSource,
  CustomerSummary,
  CustomerTransactionRow,
} from "../application/get-customer-detail";
import { overdueCondition } from "./contract-sql";

const i = installmentContracts;
// Hàm SQL migration 0013, tính như progress()/dueStatus() của domain installment.
const installmentLate = (today: LocalDate) =>
  sql`installment_late(${i.totalDue}, ${i.totalDays}, ${i.periodDays}, ${i.startDate}, ${i.amountPaid}, ${today}::date)`;
const installmentDueToday = (today: LocalDate) =>
  sql`installment_due_today(${i.totalDue}, ${i.totalDays}, ${i.periodDays}, ${i.startDate}, ${i.amountPaid}, ${today}::date)`;

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
    const customerQuery = this.db
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
    // Trả góp đang góp của khách: index (shop_id, customer_id).
    const installmentQuery = this.db
      .select({
        open: sql<number>`count(*)`.mapWith(Number),
        late: sql<number>`count(*) FILTER (WHERE ${installmentLate(today)})`.mapWith(
          Number,
        ),
        remaining: sql<string>`coalesce(sum(${i.totalDue} - ${i.amountPaid}), 0)`,
      })
      .from(i)
      .where(
        and(
          eq(i.shopId, shopId),
          eq(i.customerId, customerId),
          eq(i.status, "active"),
          isNull(i.deletedAt),
        ),
      );
    const [[row], [installment]] = await Promise.all([
      customerQuery,
      installmentQuery,
    ]);
    if (!row) return null;
    return {
      ...row,
      openContracts: row.openContracts + installment.open,
      overdueContracts: row.overdueContracts + installment.late,
      debt: Money.of(BigInt(row.debt) + BigInt(installment.remaining)),
      interestPaid: Money.of(BigInt(row.interestPaid)),
    };
  }

  async listContracts(
    shopId: string,
    customerId: string,
    today: LocalDate,
  ): Promise<CustomerContractRow[]> {
    const c = contracts;
    const pawnQuery = this.db
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
      .where(and(eq(c.shopId, shopId), eq(c.customerId, customerId)));
    const open = sql`${i.status} = 'active' AND ${i.deletedAt} IS NULL`;
    const installmentQuery = this.db
      .select({
        id: i.id,
        code: i.code,
        amountGiven: i.amountGiven,
        remaining: sql<string>`CASE WHEN ${open} THEN ${i.totalDue} - ${i.amountPaid} ELSE 0 END`,
        startDate: i.startDate,
        dueStatus: sql<CustomerInstallmentRow["dueStatus"]>`CASE WHEN ${open} THEN
          CASE WHEN ${installmentLate(today)} THEN 'late' WHEN ${installmentDueToday(today)} THEN 'today' ELSE 'on_time' END END`,
        closedAt: i.closedAt,
        deletedAt: i.deletedAt,
      })
      .from(i)
      .where(and(eq(i.shopId, shopId), eq(i.customerId, customerId)));
    const [pawnRows, installmentRows] = await Promise.all([
      pawnQuery,
      installmentQuery,
    ]);
    const rows: CustomerContractRow[] = [
      ...pawnRows.map(({ closedAt, deletedAt, ...row }) => ({
        ...row,
        type: "pawn" as const,
        principal: Money.of(row.principal),
        outstandingPrincipal: Money.of(row.outstandingPrincipal),
        closedOn: closedAt ? businessDate(closedAt) : null,
        deleted: deletedAt !== null,
      })),
      ...installmentRows.map(({ closedAt, deletedAt, ...row }) => ({
        ...row,
        type: "installment" as const,
        amountGiven: Money.of(row.amountGiven),
        remaining: Money.of(BigInt(row.remaining)),
        closedOn: closedAt ? businessDate(closedAt) : null,
        deleted: deletedAt !== null,
      })),
    ];
    // uuid v7 tăng theo thời gian tạo ở cả hai bảng: so chuỗi id là mới nhất trước.
    return rows.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  async recentTransactions(
    shopId: string,
    customerId: string,
    limit: number,
  ): Promise<CustomerTransactionRow[]> {
    const t = cashTransactions;
    const c = contracts;
    const columns = {
      id: t.id,
      occurredAt: t.occurredAt,
      type: t.type,
      amount: t.amount,
      periodFrom: t.periodFrom,
      periodTo: t.periodTo,
      note: t.note,
      reversed: sql<boolean>`EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = ${t.id})`,
    };
    // Mỗi nhánh đi index (shop_id, customer_id) của bảng hợp đồng và (shop_id, contract_id | installment_contract_id) của sổ két.
    const pawn = this.db
      .select({ ...columns, contractCode: c.code })
      .from(t)
      .innerJoin(c, and(eq(c.shopId, t.shopId), eq(c.id, t.contractId)))
      .where(and(eq(c.shopId, shopId), eq(c.customerId, customerId)));
    const installment = this.db
      .select({ ...columns, contractCode: i.code })
      .from(t)
      .innerJoin(
        i,
        and(eq(i.shopId, t.shopId), eq(i.id, t.installmentContractId)),
      )
      .where(and(eq(i.shopId, shopId), eq(i.customerId, customerId)));
    const rows = await unionAll(pawn, installment)
      .orderBy(desc(sql`occurred_at`), desc(sql`id`))
      .limit(limit);
    // Dòng gắn hợp đồng chỉ mang type của hợp đồng (CHECK cash_transactions_type_rules).
    return rows.map((row) => ({
      ...row,
      type: row.type as CustomerCashType,
      amount: Money.of(row.amount),
    }));
  }
}
