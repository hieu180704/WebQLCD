import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { dbCause, uniqueViolation } from "@/shared/infrastructure/db/errors";
import { cashTransactions, contracts, shops, users } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type { Actor, CashDayTotals, CashLine, CashbookRepository, OpeningBalanceResult } from "../application/ports";
import { appendCashEntries } from "./cash-ledger";

const OPENING_BALANCE_KEY = "cash_transactions_one_opening_balance_key";

export class DrizzleCashbookRepository implements CashbookRepository {
  constructor(private readonly db: Db) {}

  async recordOpeningBalance(actor: Actor, amount: Money): Promise<OpeningBalanceResult> {
    try {
      await this.db.transaction(async (tx) => {
        const [shop] = await tx.select({ openedAt: shops.openedAt }).from(shops).where(eq(shops.id, actor.shopId));
        if (!shop) throw new Error("Không tìm thấy cửa hàng của phiên đăng nhập");
        // Quỹ đầu két ghi vào ngày mở két (data-model mục 3.1), kể cả khi nhập sau ngày đó.
        await appendCashEntries(
          tx,
          { shopId: actor.shopId, createdBy: actor.userId, businessDate: shop.openedAt },
          [{ type: "opening_balance", amount }],
        );
      });
      return "ok";
    } catch (error) {
      if (uniqueViolation(error) === OPENING_BALANCE_KEY) return "already_set";
      throw dbCause(error);
    }
  }

  async hasOpeningBalance(shopId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: cashTransactions.id })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.shopId, shopId), eq(cashTransactions.type, "opening_balance")))
      .limit(1);
    return rows.length > 0;
  }

  async dayTotals(shopId: string, date: LocalDate): Promise<CashDayTotals> {
    // Một truy vấn trên index (shop_id, business_date); sum(bigint) trả numeric nên đọc dạng chuỗi.
    // Dòng quỹ đầu két của chính ngày D tính vào đầu ngày, không tính vào thu.
    const t = cashTransactions;
    const [row] = await this.db
      .select({
        opening: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.businessDate} < ${date} OR ${t.type} = 'opening_balance'), 0)`,
        income: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.businessDate} = ${date} AND ${t.amount} > 0 AND ${t.type} <> 'opening_balance'), 0)`,
        expense: sql<string>`coalesce(sum(${t.amount}) FILTER (WHERE ${t.businessDate} = ${date} AND ${t.amount} < 0), 0)`,
      })
      .from(cashTransactions)
      .where(and(eq(cashTransactions.shopId, shopId), sql`${cashTransactions.businessDate} <= ${date}`));
    return { opening: toMoney(row.opening), income: toMoney(row.income), expense: toMoney(row.expense) };
  }

  async listDay(shopId: string, date: LocalDate, after: string | null, limit: number): Promise<CashLine[]> {
    const rows = await this.db
      .select({
        id: cashTransactions.id,
        occurredAt: cashTransactions.occurredAt,
        type: cashTransactions.type,
        amount: cashTransactions.amount,
        contractCode: contracts.code,
        createdByName: users.name,
        note: cashTransactions.note,
      })
      .from(cashTransactions)
      // Khoá ngoại kép (shop_id, x) nên join theo cả cặp để chỉ khớp trong cùng cửa hàng.
      .leftJoin(contracts, and(eq(contracts.shopId, cashTransactions.shopId), eq(contracts.id, cashTransactions.contractId)))
      .innerJoin(users, and(eq(users.shopId, cashTransactions.shopId), eq(users.id, cashTransactions.createdBy)))
      .where(
        and(
          eq(cashTransactions.shopId, shopId),
          eq(cashTransactions.businessDate, date),
          after ? lt(cashTransactions.id, after) : undefined,
        ),
      )
      .orderBy(desc(cashTransactions.id)) // uuid v7 tăng theo thời gian tạo.
      .limit(limit);
    return rows.map((row) => ({ ...row, amount: Money.of(row.amount) }));
  }
}

function toMoney(value: string | number): Money {
  return Money.of(BigInt(value));
}
