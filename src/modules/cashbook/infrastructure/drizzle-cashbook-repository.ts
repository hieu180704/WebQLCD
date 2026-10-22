import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/shared/infrastructure/db/client";
import { dbCause, uniqueViolation } from "@/shared/infrastructure/db/errors";
import { auditLogs, cashTransactions, contracts, shops, users } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import type {
  Actor,
  CashDayTotals,
  CashLine,
  CashbookRepository,
  ManualEntry,
  OpeningBalanceResult,
  ReverseManualResult,
} from "../application/ports";
import { isManualEntryType } from "../domain/cash-entry";
import { appendCashEntries } from "./cash-ledger";

const OPENING_BALANCE_KEY = "cash_transactions_one_opening_balance_key";
const ONE_REVERSAL_KEY = "cash_transactions_reverses_id_unique";

// Dòng gốc mà một dòng đảo trỏ tới, và dòng đảo của một dòng gốc (UNIQUE reverses_id nên tối đa một).
const original = alias(cashTransactions, "original");
const reversal = alias(cashTransactions, "reversal");

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

  async recordManualEntry(actor: Actor, entry: ManualEntry, date: LocalDate): Promise<void> {
    const operationId = randomUUID();
    await this.db.transaction(async (tx) => {
      await appendCashEntries(
        tx,
        { shopId: actor.shopId, createdBy: actor.userId, businessDate: date, operationId, note: entry.note ?? undefined },
        [{ type: entry.type, amount: entry.amount }],
      );
      await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "cash", entityId: operationId, action: "create" });
    });
  }

  async reverseManualEntry(actor: Actor, transactionId: string, reason: string, date: LocalDate): Promise<ReverseManualResult> {
    const t = cashTransactions;
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ type: t.type, amount: t.amount, operationId: t.operationId, reversalId: reversal.id })
          .from(t)
          .leftJoin(reversal, and(eq(reversal.shopId, t.shopId), eq(reversal.reversesId, t.id)))
          .where(and(eq(t.shopId, actor.shopId), eq(t.id, transactionId)));
        if (!row) return "not_found";
        if (!isManualEntryType(row.type)) return "not_manual";
        if (row.reversalId) return "already_reversed";
        await appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: date, note: reason }, [
          { type: "reversal", reversesId: transactionId, contractId: null, amount: Money.of(row.amount) },
        ]);
        // Nhật ký gắn với operation_id của phiếu gốc, cùng chuỗi với dòng `create`.
        await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "cash", entityId: row.operationId, action: "reverse" });
        return "ok";
      });
    } catch (error) {
      // Hai người huỷ cùng lúc: người sau vướng UNIQUE (reverses_id).
      if (uniqueViolation(error) === ONE_REVERSAL_KEY) return "already_reversed";
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
    const t = cashTransactions;
    const rows = await this.db
      .select({
        id: t.id,
        occurredAt: t.occurredAt,
        type: t.type,
        amount: t.amount,
        contractId: t.contractId,
        contractCode: contracts.code,
        createdByName: users.name,
        note: t.note,
        reversalId: reversal.id,
        originalType: original.type,
        originalAt: original.occurredAt,
      })
      .from(t)
      // Khoá ngoại kép (shop_id, x) nên join theo cả cặp để chỉ khớp trong cùng cửa hàng.
      .leftJoin(contracts, and(eq(contracts.shopId, t.shopId), eq(contracts.id, t.contractId)))
      .innerJoin(users, and(eq(users.shopId, t.shopId), eq(users.id, t.createdBy)))
      .leftJoin(original, and(eq(original.shopId, t.shopId), eq(original.id, t.reversesId)))
      .leftJoin(reversal, and(eq(reversal.shopId, t.shopId), eq(reversal.reversesId, t.id)))
      .where(and(eq(t.shopId, shopId), eq(t.businessDate, date), after ? lt(t.id, after) : undefined))
      .orderBy(desc(t.id)) // uuid v7 tăng theo thời gian tạo.
      .limit(limit);
    return rows.map(({ reversalId, originalType, originalAt, ...row }) => ({
      ...row,
      amount: Money.of(row.amount),
      reversed: reversalId !== null,
      reverses: originalType && originalAt ? { type: originalType, occurredAt: originalAt } : null,
    }));
  }
}

function toMoney(value: string | number): Money {
  return Money.of(BigInt(value));
}
