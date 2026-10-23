import "server-only";
import { and, asc, desc, eq, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { AppendCashEntries } from "@/modules/cashbook";
// Chỉ kiểu: index của customer kéo theo presentation, mà presentation import composition-root (vòng import).
import type { DrizzleCustomerWriter } from "@/modules/customer";
import type { Db, Tx } from "@/shared/infrastructure/db/client";
import { dbCause } from "@/shared/infrastructure/db/errors";
import { escapeLike } from "@/shared/infrastructure/db/like";
import {
  auditLogs,
  cashTransactions,
  customers,
  installmentContracts,
  installmentOperations,
  shopCounters,
  users,
} from "@/shared/infrastructure/db/schema";
import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { maskPhone } from "@/shared/kernel/personal-data";
import { CODE_PREFIX, type OperationKind } from "../domain/installment";
import type {
  Actor,
  CreatedInstallment,
  DeletionDraft,
  InstallmentCashType,
  InstallmentDetailRow,
  InstallmentDraft,
  InstallmentFilter,
  InstallmentListRow,
  InstallmentRecord,
  InstallmentRepository,
  InstallmentStats,
  InstallmentStatusFilter,
  InstallmentTransaction,
  LatestOperation,
  PaymentDraft,
  PaymentRecord,
  ReversalDraft,
} from "../application/ports";

const AUDIT_ENTITY = "installment_contract";

/** HMAC CCCD theo cửa hàng (CccdCipher.hash), ghép qua composition-root. */
export type HashCccd = (shopId: string, cccd: string) => string;

/** Tìm SĐT khi ô tìm có ít nhất chừng này chữ số. */
const MIN_PHONE_DIGITS = 3;

const c = installmentContracts;
// Hàm SQL migration 0011, tính như progress()/dueStatus() của domain.
const late = (today: LocalDate) =>
  sql`installment_late(${c.totalDue}, ${c.totalDays}, ${c.periodDays}, ${c.startDate}, ${c.amountPaid}, ${today}::date)`;
const dueToday = (today: LocalDate) =>
  sql`installment_due_today(${c.totalDue}, ${c.totalDays}, ${c.periodDays}, ${c.startDate}, ${c.amountPaid}, ${today}::date)`;

export class DrizzleInstallmentRepository implements InstallmentRepository {
  constructor(
    private readonly db: Db,
    private readonly customerWriter: DrizzleCustomerWriter,
    private readonly appendCashEntries: AppendCashEntries,
    private readonly hashCccd: HashCccd,
  ) {}

  async create(actor: Actor, draft: InstallmentDraft): Promise<CreatedInstallment> {
    const { terms } = draft;
    try {
      // Khách, mã, hợp đồng, sổ két, audit cùng có hoặc cùng không (architecture-spec mục 2.2).
      return await this.db.transaction(async (tx) => {
        const customer = await this.customerWriter.resolve(tx, actor, draft.customer);
        const code = await nextCode(tx, actor.shopId);
        const [contract] = await tx
          .insert(installmentContracts)
          .values({
            shopId: actor.shopId,
            code,
            customerId: customer.id,
            amountGiven: terms.amountGiven.toBigInt(),
            totalDue: terms.totalDue.toBigInt(),
            totalDays: terms.totalDays,
            periodDays: terms.periodDays,
            startDate: terms.startDate,
            note: draft.note,
            staffId: actor.userId,
          })
          .returning({ id: installmentContracts.id });
        const operationId = await insertOperation(tx, actor, contract.id, "disbursement");
        await this.appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate, operationId }, [
          { type: "installment_disbursement", installmentContractId: contract.id, amount: terms.amountGiven },
        ]);
        await tx
          .insert(auditLogs)
          .values({ shopId: actor.shopId, userId: actor.userId, entity: AUDIT_ENTITY, entityId: contract.id, action: "create" });
        return { code, customer };
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async list(
    shopId: string,
    filter: InstallmentFilter,
    today: LocalDate,
    after: string | null,
    limit: number,
  ): Promise<InstallmentListRow[]> {
    const rows = await this.db
      .select({
        id: c.id,
        code: c.code,
        customerId: c.customerId,
        customerName: customers.fullName,
        customerPhone: customers.phone,
        amountGiven: c.amountGiven,
        totalDue: c.totalDue,
        amountPaid: c.amountPaid,
        totalDays: c.totalDays,
        periodDays: c.periodDays,
        startDate: c.startDate,
        status: c.status,
        deletedAt: c.deletedAt,
      })
      .from(c)
      .innerJoin(customers, and(eq(customers.shopId, c.shopId), eq(customers.id, c.customerId)))
      .where(
        and(
          eq(c.shopId, shopId),
          statusCondition(filter.status, today),
          searchCondition(filter.search),
          filter.cccd ? eq(customers.cccdHash, this.hashCccd(shopId, filter.cccd)) : undefined,
          after ? lt(c.id, after) : undefined,
        ),
      )
      .orderBy(desc(c.id)) // uuid v7 tăng theo thời gian tạo; index UNIQUE (shop_id, id).
      .limit(limit);
    return rows.map(({ deletedAt, ...row }) => ({
      ...row,
      deleted: deletedAt !== null,
      customerPhone: row.customerPhone ? maskPhone(row.customerPhone) : null,
      amountGiven: Money.of(row.amountGiven),
      totalDue: Money.of(row.totalDue),
      amountPaid: Money.of(row.amountPaid),
    }));
  }

  async stats(shopId: string, today: LocalDate, monthStart: LocalDate, nextMonthStart: LocalDate): Promise<InstallmentStats> {
    // Hợp đồng đang góp: index (shop_id, status).
    const [open] = await this.db
      .select({
        openCount: sql<number>`count(*)::int`,
        givenOpen: sql<string>`coalesce(sum(${c.amountGiven}), 0)::text`,
        remainingOpen: sql<string>`coalesce(sum(${c.totalDue} - ${c.amountPaid}), 0)::text`,
        lateCount: sql<number>`count(*) FILTER (WHERE ${late(today)})::int`,
      })
      .from(c)
      .where(and(eq(c.shopId, shopId), eq(c.status, "active"), isNull(c.deletedAt)));
    // Sổ két theo ngày: index (shop_id, business_date). Dòng huỷ chỉ trừ khi dòng gốc là thu trả góp (bỏ đảo giải ngân).
    const t = cashTransactions;
    const [cash] = await this.db
      .select({
        collected: sql<string>`coalesce(sum(${t.amount}), 0)::text`,
      })
      .from(t)
      .where(
        and(
          eq(t.shopId, shopId),
          sql`${t.businessDate} >= ${monthStart}::date AND ${t.businessDate} < ${nextMonthStart}::date`,
          or(
            eq(t.type, "installment_payment"),
            sql`${t.type} = 'reversal' AND EXISTS (
              SELECT 1 FROM cash_transactions g WHERE g.id = ${t.reversesId} AND g.type = 'installment_payment'
            )`,
          ),
        ),
      );
    return {
      openCount: open.openCount,
      givenOpen: Money.of(BigInt(open.givenOpen)),
      remainingOpen: Money.of(BigInt(open.remainingOpen)),
      collectedThisMonth: Money.of(BigInt(cash.collected)),
      lateCount: open.lateCount,
    };
  }

  async findDetail(shopId: string, contractId: string): Promise<InstallmentDetailRow | null> {
    const [row] = await this.db
      .select({
        id: c.id,
        code: c.code,
        customerId: c.customerId,
        customerName: customers.fullName,
        amountGiven: c.amountGiven,
        totalDue: c.totalDue,
        amountPaid: c.amountPaid,
        totalDays: c.totalDays,
        periodDays: c.periodDays,
        startDate: c.startDate,
        status: c.status,
        note: c.note,
        staffName: users.name,
        closedAt: c.closedAt,
        phone: customers.phone,
        address: customers.address,
        cccdMasked: customers.cccdMasked,
        deletedAt: c.deletedAt,
        deletedReason: c.deletedReason,
        // Index (shop_id, installment_contract_id) và UNIQUE (reverses_id).
        ledgerNet: sql<string>`coalesce((
          SELECT sum(t.amount) FROM cash_transactions t
          WHERE t.shop_id = ${c.shopId} AND t.installment_contract_id = ${c.id} AND t.type <> 'reversal'
            AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id)
        ), 0)`,
      })
      .from(c)
      .innerJoin(customers, and(eq(customers.shopId, c.shopId), eq(customers.id, c.customerId)))
      .innerJoin(users, and(eq(users.shopId, c.shopId), eq(users.id, c.staffId)))
      // Hợp đồng đã xoá vẫn xem được (mockup); findRecord lọc bỏ nên không thao tác được.
      .where(and(eq(c.shopId, shopId), eq(c.id, contractId)));
    if (!row) return null;
    const { phone, address, cccdMasked, closedAt, deletedAt, deletedReason, ledgerNet, ...contract } = row;
    return {
      ...contract,
      closedOn: closedAt ? businessDate(closedAt) : null,
      amountGiven: Money.of(row.amountGiven),
      totalDue: Money.of(row.totalDue),
      amountPaid: Money.of(row.amountPaid),
      customer: { phone, address, cccdMasked },
      ledgerNet: Money.of(BigInt(ledgerNet)),
      deleted: deletedAt ? { on: businessDate(deletedAt), reason: deletedReason ?? "" } : null,
    };
  }

  async listTransactions(shopId: string, contractId: string, limit: number): Promise<InstallmentTransaction[]> {
    const t = cashTransactions;
    const o = installmentOperations;
    const rows = await this.db
      .select({
        id: t.id,
        occurredAt: t.occurredAt,
        type: t.type,
        amount: t.amount,
        operationKind: o.kind,
        createdByName: users.name,
        note: t.note,
        reversed: sql<boolean>`EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = ${t.id})`,
      })
      .from(t)
      .innerJoin(users, and(eq(users.shopId, t.shopId), eq(users.id, t.createdBy)))
      .leftJoin(o, and(eq(o.shopId, t.shopId), eq(o.id, t.operationId)))
      .where(and(eq(t.shopId, shopId), eq(t.installmentContractId, contractId)))
      .orderBy(desc(t.id)) // uuid v7 tăng theo thời gian tạo.
      .limit(limit);
    // installment_contract_id chỉ gắn với các loại giao dịch trả góp (CHECK cash_transactions_type_rules).
    return rows.map((row) => ({ ...row, type: row.type as InstallmentCashType, amount: Money.of(row.amount) }));
  }

  async listPayments(shopId: string, contractId: string): Promise<PaymentRecord[]> {
    const t = cashTransactions;
    const rows = await this.db
      .select({ id: t.id, on: t.businessDate, amount: t.amount })
      .from(t)
      .where(
        and(
          eq(t.shopId, shopId),
          eq(t.installmentContractId, contractId),
          eq(t.type, "installment_payment"),
          sql`NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = ${t.id})`,
        ),
      )
      .orderBy(asc(t.id));
    return rows.map((row) => ({ ...row, amount: Money.of(row.amount) }));
  }

  async findRecord(shopId: string, contractId: string): Promise<InstallmentRecord | null> {
    const [row] = await this.db
      .select({
        code: c.code,
        status: c.status,
        totalDue: c.totalDue,
        totalDays: c.totalDays,
        periodDays: c.periodDays,
        startDate: c.startDate,
        amountPaid: c.amountPaid,
      })
      .from(c)
      .where(and(eq(c.shopId, shopId), eq(c.id, contractId), isNull(c.deletedAt)));
    if (!row) return null;
    return { ...row, totalDue: Money.of(row.totalDue), amountPaid: Money.of(row.amountPaid) };
  }

  async recordPayment(actor: Actor, draft: PaymentDraft): Promise<boolean> {
    const { contractId, payment } = draft;
    try {
      return await this.db.transaction(async (tx) => {
        // UPDATE có điều kiện khoá dòng hợp đồng: hai lần thu đồng thời thì lần sau không khớp số đã thu.
        const updated = await tx
          .update(c)
          .set({
            amountPaid: payment.paidAfter.toBigInt(),
            ...(payment.closes && { status: "closed" as const, closedAt: sql`now()` }),
          })
          .where(
            and(
              eq(c.shopId, actor.shopId),
              eq(c.id, contractId),
              eq(c.status, "active"),
              isNull(c.deletedAt),
              eq(c.amountPaid, draft.expectedPaid.toBigInt()),
            ),
          )
          .returning({ id: c.id });
        if (updated.length === 0) return false;
        const operationId = await insertOperation(tx, actor, contractId, draft.kind);
        // Tất toán thu 0 đồng không có dòng sổ két (sổ két cấm amount = 0).
        if (payment.amount.isPositive()) {
          await this.appendCashEntries(
            tx,
            { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate, operationId },
            [{ type: "installment_payment", installmentContractId: contractId, amount: payment.amount }],
          );
        }
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: AUDIT_ENTITY,
          entityId: contractId,
          action: draft.kind,
          changedFields: payment.closes ? ["amount_paid", "status"] : ["amount_paid"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async findLatestOperation(shopId: string, contractId: string): Promise<LatestOperation | null> {
    const o = installmentOperations;
    const [row] = await this.db
      .select({
        id: o.id,
        kind: o.kind,
        createdAt: o.createdAt,
        createdByName: users.name,
        cashNet: sql<string>`coalesce((
          SELECT sum(t.amount) FROM cash_transactions t WHERE t.shop_id = ${o.shopId} AND t.operation_id = ${o.id}
        ), 0)`,
      })
      .from(o)
      .innerJoin(c, and(eq(c.shopId, o.shopId), eq(c.id, o.installmentContractId)))
      .innerJoin(users, and(eq(users.shopId, o.shopId), eq(users.id, o.createdBy)))
      .where(and(eq(o.shopId, shopId), eq(o.installmentContractId, contractId), isNull(o.reversedAt), isNull(c.deletedAt)))
      .orderBy(desc(o.createdAt), desc(o.id))
      .limit(1);
    return row ? { ...row, cashNet: Money.of(BigInt(row.cashNet)) } : null;
  }

  async reverseOperation(actor: Actor, draft: ReversalDraft): Promise<boolean> {
    const { contractId, operationId } = draft;
    const o = installmentOperations;
    try {
      return await this.db.transaction(async (tx) => {
        // Khoá dòng hợp đồng như các thao tác khác: thao tác đồng thời phải chờ, rồi thấy thao tác mới nhất đã đổi.
        const [locked] = await tx
          .select({ id: c.id })
          .from(c)
          .where(and(eq(c.shopId, actor.shopId), eq(c.id, contractId), isNull(c.deletedAt)))
          .for("update");
        if (!locked) return false;
        const [latest] = await tx
          .select({ id: o.id, kind: o.kind })
          .from(o)
          .where(and(eq(o.shopId, actor.shopId), eq(o.installmentContractId, contractId), isNull(o.reversedAt)))
          .orderBy(desc(o.createdAt), desc(o.id))
          .limit(1);
        if (!latest || latest.id !== operationId || latest.kind === "disbursement") return false;
        await tx
          .update(o)
          .set({ reversedAt: sql`now()`, reversedBy: actor.userId, reverseReason: draft.reason })
          .where(and(eq(o.shopId, actor.shopId), eq(o.id, operationId)));

        await this.reverseCash(tx, actor, draft.businessDate, draft.reason, eq(cashTransactions.operationId, operationId));
        // Tính lại từ các lần thu chưa đảo (data-model mục 4). Hợp đồng đã đóng thì thao tác mới nhất chính là lần đóng,
        // nên huỷ thao tác mới nhất luôn để hợp đồng ở trạng thái đang góp.
        await tx
          .update(c)
          .set({
            amountPaid: sql`coalesce((
              SELECT sum(t.amount) FROM cash_transactions t
              WHERE t.shop_id = ${c.shopId} AND t.installment_contract_id = ${c.id} AND t.type = 'installment_payment'
                AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id)
            ), 0)`,
            status: "active",
            closedAt: null,
          })
          .where(and(eq(c.shopId, actor.shopId), eq(c.id, contractId)));
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: AUDIT_ENTITY,
          entityId: contractId,
          action: "reverse",
          changedFields: latest.kind === "close" ? ["amount_paid", "status"] : ["amount_paid"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async deleteContract(actor: Actor, draft: DeletionDraft): Promise<boolean> {
    const { contractId } = draft;
    try {
      return await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(c)
          .set({ deletedAt: sql`now()`, deletedBy: actor.userId, deletedReason: draft.reason })
          .where(and(eq(c.shopId, actor.shopId), eq(c.id, contractId), isNull(c.deletedAt)))
          .returning({ id: c.id });
        if (updated.length === 0) return false;
        await this.reverseCash(tx, actor, draft.businessDate, draft.reason, eq(cashTransactions.installmentContractId, contractId));
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: AUDIT_ENTITY,
          entityId: contractId,
          action: "delete",
          changedFields: ["deleted_at", "deleted_reason"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  /** Đảo mọi dòng trả góp chưa đảo khớp `filter` trong cửa hàng, chung một operation_id mới, ghi chú là lý do. */
  private async reverseCash(tx: Tx, actor: Actor, date: LocalDate, reason: string, filter: SQL): Promise<void> {
    const t = cashTransactions;
    const originals = await tx
      .select({ id: t.id, installmentContractId: t.installmentContractId, amount: t.amount })
      .from(t)
      .where(
        and(
          eq(t.shopId, actor.shopId),
          filter,
          isNotNull(t.installmentContractId),
          sql`${t.type} <> 'reversal'`,
          sql`NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = ${t.id})`,
        ),
      );
    await this.appendCashEntries(
      tx,
      { shopId: actor.shopId, createdBy: actor.userId, businessDate: date, note: reason },
      originals.map((row) => ({
        type: "reversal",
        reversesId: row.id,
        contractId: null,
        installmentContractId: row.installmentContractId,
        amount: Money.of(row.amount),
      })),
    );
  }
}

/** Lịch sử theo thứ tự ghi: `clock_timestamp()` lấy sau khi đã khoá dòng hợp đồng, nên thao tác ghi sau luôn mới hơn. */
async function insertOperation(tx: Tx, actor: Actor, contractId: string, kind: OperationKind): Promise<string> {
  const [row] = await tx
    .insert(installmentOperations)
    .values({ shopId: actor.shopId, installmentContractId: contractId, kind, createdBy: actor.userId, createdAt: sql`clock_timestamp()` })
    .returning({ id: installmentOperations.id });
  return row.id;
}

/** Cấp mã TG-n: upsert khoá dòng bộ đếm tới hết transaction nên hai hợp đồng đồng thời không trùng mã. */
async function nextCode(tx: Tx, shopId: string): Promise<string> {
  // `next_value` là số sẽ cấp tiếp theo: lần đầu chèn 2 và cấp 1, các lần sau tăng 1 và cấp giá trị cũ.
  const [row] = await tx
    .insert(shopCounters)
    .values({ shopId, prefix: CODE_PREFIX, nextValue: 2n })
    .onConflictDoUpdate({ target: [shopCounters.shopId, shopCounters.prefix], set: { nextValue: sql`${shopCounters.nextValue} + 1` } })
    .returning({ nextValue: shopCounters.nextValue });
  return `${CODE_PREFIX}${row.nextValue - 1n}`;
}

/** Điều kiện trạng thái của bộ lọc danh sách; null = mọi hợp đồng chưa xoá. */
function statusCondition(status: InstallmentStatusFilter | null, today: LocalDate): SQL | undefined {
  const notDeleted = isNull(c.deletedAt);
  const open = and(eq(c.status, "active"), notDeleted);
  switch (status) {
    case null:
      return notDeleted;
    case "open":
      return open;
    case "late":
      return and(open, late(today));
    case "due_today":
      return and(open, dueToday(today));
    case "closed":
      return and(eq(c.status, "closed"), notDeleted);
    case "deleted":
      return isNotNull(c.deletedAt);
  }
}

/** Mã HĐ, tên khách (không dấu, không phân biệt hoa thường; index trigram), SĐT khi ô tìm có từ MIN_PHONE_DIGITS chữ số. */
function searchCondition(search: string | null): SQL | undefined {
  if (!search) return undefined;
  const pattern = sql`'%' || search_text(${escapeLike(search)}) || '%'`;
  const digits = search.replace(/\D/g, "");
  return or(
    ilike(c.code, `%${escapeLike(search)}%`),
    sql`search_text(${customers.fullName}) LIKE ${pattern}`,
    digits.length >= MIN_PHONE_DIGITS ? sql`${customers.phone} LIKE ${`%${digits}%`}` : undefined,
  );
}
