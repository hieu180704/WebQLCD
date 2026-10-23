import "server-only";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { AppendCashEntries } from "@/modules/cashbook";
// Chỉ kiểu: index của customer kéo theo presentation, mà presentation import composition-root (vòng import).
import type { DrizzleCustomerWriter } from "@/modules/customer";
import type { Db, Tx } from "@/shared/infrastructure/db/client";
import { dbCause } from "@/shared/infrastructure/db/errors";
import { auditLogs, customers, installmentContracts, installmentOperations, shopCounters } from "@/shared/infrastructure/db/schema";
import { Money } from "@/shared/kernel/money";
import { maskPhone } from "@/shared/kernel/personal-data";
import { CODE_PREFIX } from "../domain/installment";
import type { Actor, CreatedInstallment, InstallmentDraft, InstallmentListRow, InstallmentRepository } from "../application/ports";

/** Loại thao tác trên hợp đồng trả góp (bảng `installment_operations`). */
type OperationKind = (typeof installmentOperations.kind.enumValues)[number];

const AUDIT_ENTITY = "installment_contract";

export class DrizzleInstallmentRepository implements InstallmentRepository {
  constructor(
    private readonly db: Db,
    private readonly customerWriter: DrizzleCustomerWriter,
    private readonly appendCashEntries: AppendCashEntries,
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

  async list(shopId: string, after: string | null, limit: number): Promise<InstallmentListRow[]> {
    const c = installmentContracts;
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
      .where(and(eq(c.shopId, shopId), isNull(c.deletedAt), after ? lt(c.id, after) : undefined))
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
