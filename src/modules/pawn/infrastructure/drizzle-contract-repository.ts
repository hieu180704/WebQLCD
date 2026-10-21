import "server-only";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { AppendCashEntries, CashEntry } from "@/modules/cashbook";
import { maskPhone, type DrizzleCustomerWriter } from "@/modules/customer";
import type { Db, Tx } from "@/shared/infrastructure/db/client";
import { dbCause } from "@/shared/infrastructure/db/errors";
import { auditLogs, cashTransactions, contracts, customers, shopCounters, users } from "@/shared/infrastructure/db/schema";
import { businessDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { CODE_PREFIX, type ContractKind } from "../domain/contract";
import { formatRate, parseRate } from "../domain/interest/rate";
import type {
  Actor,
  ContractCashType,
  ContractDetailRow,
  ContractDraft,
  ContractListRow,
  ContractRepository,
  ContractStanding,
  ContractTransaction,
  CreatedContract,
  ExtensionDraft,
  InterestPaymentDraft,
  PrincipalChangeDraft,
  RedemptionDraft,
} from "../application/ports";

export class DrizzleContractRepository implements ContractRepository {
  constructor(
    private readonly db: Db,
    private readonly customerWriter: DrizzleCustomerWriter,
    private readonly appendCashEntries: AppendCashEntries,
  ) {}

  async create(actor: Actor, draft: ContractDraft): Promise<CreatedContract> {
    const { terms, disbursement } = draft;
    try {
      // Khách, mã, hợp đồng, sổ két, audit cùng có hoặc cùng không (architecture-spec mục 2.2).
      return await this.db.transaction(async (tx) => {
        const customer = await this.customerWriter.resolve(tx, actor, draft.customer);
        const code = await nextCode(tx, actor.shopId, terms.kind);
        const [contract] = await tx
          .insert(contracts)
          .values({
            shopId: actor.shopId,
            code,
            customerId: customer.id,
            kind: terms.kind,
            assetName: terms.assetName,
            principal: terms.principal.toBigInt(),
            outstandingPrincipal: terms.principal.toBigInt(),
            interestType: terms.interestType,
            interestRate: formatRate(terms.interestRate),
            interestPeriodDays: terms.interestPeriodDays,
            termDays: terms.termDays,
            loanDate: terms.loanDate,
            interestPaidUntil: disbursement.interestPaidUntil,
            prepaidInterest: terms.prepaidInterest,
            note: draft.note,
            staffId: actor.userId,
          })
          .returning({ id: contracts.id });

        const entries: CashEntry[] = [{ type: "disbursement", contractId: contract.id, amount: disbursement.principal }];
        if (disbursement.prepaid) {
          const { from, to, amount } = disbursement.prepaid;
          entries.push({ type: "interest_payment", contractId: contract.id, amount, periodFrom: from, periodTo: to });
        }
        await this.appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate }, entries);
        await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "contract", entityId: contract.id, action: "create" });
        return { code, customer };
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async list(shopId: string, after: string | null, limit: number): Promise<ContractListRow[]> {
    const rows = await this.db
      .select({
        id: contracts.id,
        code: contracts.code,
        customerName: customers.fullName,
        customerPhone: customers.phone,
        kind: contracts.kind,
        assetName: contracts.assetName,
        principal: contracts.principal,
        outstandingPrincipal: contracts.outstandingPrincipal,
        loanDate: contracts.loanDate,
        interestType: contracts.interestType,
        interestRate: contracts.interestRate,
        interestPeriodDays: contracts.interestPeriodDays,
        interestPaidUntil: contracts.interestPaidUntil,
        prepaidInterest: contracts.prepaidInterest,
        status: contracts.status,
      })
      .from(contracts)
      .innerJoin(customers, and(eq(customers.shopId, contracts.shopId), eq(customers.id, contracts.customerId)))
      .where(and(eq(contracts.shopId, shopId), isNull(contracts.deletedAt), after ? lt(contracts.id, after) : undefined))
      .orderBy(desc(contracts.id)) // uuid v7 tăng theo thời gian tạo; index UNIQUE (shop_id, id).
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      customerPhone: row.customerPhone ? maskPhone(row.customerPhone) : null,
      principal: Money.of(row.principal),
      outstandingPrincipal: Money.of(row.outstandingPrincipal),
      interestRate: rateFromDb(row.interestRate),
    }));
  }

  async findDetail(shopId: string, contractId: string): Promise<ContractDetailRow | null> {
    const [row] = await this.db
      .select({
        id: contracts.id,
        code: contracts.code,
        customerName: customers.fullName,
        kind: contracts.kind,
        assetName: contracts.assetName,
        principal: contracts.principal,
        outstandingPrincipal: contracts.outstandingPrincipal,
        loanDate: contracts.loanDate,
        interestType: contracts.interestType,
        interestRate: contracts.interestRate,
        interestPeriodDays: contracts.interestPeriodDays,
        interestPaidUntil: contracts.interestPaidUntil,
        prepaidInterest: contracts.prepaidInterest,
        status: contracts.status,
        termDays: contracts.termDays,
        note: contracts.note,
        staffName: users.name,
        closedAt: contracts.closedAt,
        phone: customers.phone,
        address: customers.address,
        cccdMasked: customers.cccdMasked,
        // Lãi đã thu trừ dòng đã bị đảo; index (shop_id, contract_id) và UNIQUE (reverses_id).
        interestPaid: sql<string>`coalesce((
          SELECT sum(t.amount) FROM cash_transactions t
          WHERE t.shop_id = ${contracts.shopId} AND t.contract_id = ${contracts.id} AND t.type = 'interest_payment'
            AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = t.id)
        ), 0)`,
      })
      .from(contracts)
      .innerJoin(customers, and(eq(customers.shopId, contracts.shopId), eq(customers.id, contracts.customerId)))
      .innerJoin(users, and(eq(users.shopId, contracts.shopId), eq(users.id, contracts.staffId)))
      .where(and(eq(contracts.shopId, shopId), eq(contracts.id, contractId), isNull(contracts.deletedAt)));
    if (!row) return null;
    const { phone, address, cccdMasked, interestPaid, closedAt, ...contract } = row;
    return {
      ...contract,
      closedOn: closedAt ? businessDate(closedAt) : null,
      principal: Money.of(row.principal),
      outstandingPrincipal: Money.of(row.outstandingPrincipal),
      interestRate: rateFromDb(row.interestRate),
      customer: { phone, address, cccdMasked },
      interestPaid: Money.of(BigInt(interestPaid)),
    };
  }

  async listTransactions(shopId: string, contractId: string, limit: number): Promise<ContractTransaction[]> {
    const t = cashTransactions;
    const rows = await this.db
      .select({
        id: t.id,
        occurredAt: t.occurredAt,
        type: t.type,
        amount: t.amount,
        periodFrom: t.periodFrom,
        periodTo: t.periodTo,
        createdByName: users.name,
        reversed: sql<boolean>`EXISTS (SELECT 1 FROM cash_transactions r WHERE r.reverses_id = ${t.id})`,
      })
      .from(t)
      .innerJoin(users, and(eq(users.shopId, t.shopId), eq(users.id, t.createdBy)))
      .where(and(eq(t.shopId, shopId), eq(t.contractId, contractId)))
      .orderBy(desc(t.id)) // uuid v7 tăng theo thời gian tạo.
      .limit(limit);
    // contract_id chỉ gắn với các loại giao dịch hợp đồng (CHECK cash_transactions_type_rules).
    return rows.map((row) => ({ ...row, type: row.type as ContractCashType, amount: Money.of(row.amount) }));
  }

  async findStanding(shopId: string, contractId: string): Promise<ContractStanding | null> {
    const [row] = await this.db
      .select({
        status: contracts.status,
        interestType: contracts.interestType,
        interestRate: contracts.interestRate,
        interestPeriodDays: contracts.interestPeriodDays,
        outstandingPrincipal: contracts.outstandingPrincipal,
        interestPaidUntil: contracts.interestPaidUntil,
        prepaidInterest: contracts.prepaidInterest,
        termDays: contracts.termDays,
      })
      .from(contracts)
      .where(and(eq(contracts.shopId, shopId), eq(contracts.id, contractId), isNull(contracts.deletedAt)));
    if (!row) return null;
    return { ...row, outstandingPrincipal: Money.of(row.outstandingPrincipal), interestRate: rateFromDb(row.interestRate) };
  }

  async recordInterestPayment(actor: Actor, draft: InterestPaymentDraft): Promise<boolean> {
    const { contractId, payment } = draft;
    try {
      return await this.db.transaction(async (tx) => {
        // UPDATE có điều kiện khoá dòng hợp đồng: hai lần đóng lãi đồng thời thì lần sau không khớp ngày trả đến.
        const updated = await tx
          .update(contracts)
          .set({ interestPaidUntil: payment.to })
          .where(
            and(
              eq(contracts.shopId, actor.shopId),
              eq(contracts.id, contractId),
              eq(contracts.status, "active"),
              isNull(contracts.deletedAt),
              eq(contracts.interestPaidUntil, payment.from),
              eq(contracts.outstandingPrincipal, draft.expectedOutstanding.toBigInt()),
            ),
          )
          .returning({ id: contracts.id });
        if (updated.length === 0) return false;
        await this.appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate }, [
          { type: "interest_payment", contractId, amount: payment.amount, periodFrom: payment.from, periodTo: payment.to },
        ]);
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: "contract",
          entityId: contractId,
          action: "pay_interest",
          changedFields: ["interest_paid_until"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async recordRedemption(actor: Actor, draft: RedemptionDraft): Promise<boolean> {
    const { contractId, redemption } = draft;
    const { interest, principal } = redemption;
    try {
      return await this.db.transaction(async (tx) => {
        // Như recordInterestPayment: UPDATE có điều kiện khoá dòng, thao tác đồng thời thì lần sau không khớp.
        const updated = await tx
          .update(contracts)
          .set({
            status: "closed",
            closedAt: sql`now()`,
            outstandingPrincipal: 0n,
            // Khớp đối soát: ngày trả đến = max(period_to) của dòng thu lãi; không thu lãi thì giữ nguyên.
            ...(interest && { interestPaidUntil: interest.to }),
          })
          .where(
            and(
              eq(contracts.shopId, actor.shopId),
              eq(contracts.id, contractId),
              eq(contracts.status, "active"),
              isNull(contracts.deletedAt),
              eq(contracts.interestPaidUntil, draft.expectedPaidUntil),
              eq(contracts.outstandingPrincipal, principal.toBigInt()),
            ),
          )
          .returning({ id: contracts.id });
        if (updated.length === 0) return false;
        const entries: CashEntry[] = [];
        if (interest) {
          entries.push({ type: "interest_payment", contractId, amount: interest.amount, periodFrom: interest.from, periodTo: interest.to });
        }
        if (principal.isPositive()) entries.push({ type: "principal_repayment", contractId, amount: principal });
        // Một lần gọi = một operation_id cho cả dòng lãi và dòng gốc (data-model mục 2.5).
        await this.appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate }, entries);
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: "contract",
          entityId: contractId,
          action: "close",
          changedFields: interest ? ["status", "outstanding_principal", "interest_paid_until"] : ["status", "outstanding_principal"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async recordPrincipalChange(actor: Actor, draft: PrincipalChangeDraft): Promise<boolean> {
    const { contractId, change } = draft;
    const { interest } = change;
    try {
      return await this.db.transaction(async (tx) => {
        // Như recordInterestPayment: UPDATE có điều kiện khoá dòng, thao tác đồng thời thì lần sau không khớp.
        const updated = await tx
          .update(contracts)
          .set({
            outstandingPrincipal: change.outstandingAfter.toBigInt(),
            // Khớp đối soát: ngày trả đến = max(period_to). Lãi bổ sung khi vay thêm có `to` = ngày trả đến cũ.
            ...(interest && { interestPaidUntil: interest.to }),
          })
          .where(
            and(
              eq(contracts.shopId, actor.shopId),
              eq(contracts.id, contractId),
              eq(contracts.status, "active"),
              isNull(contracts.deletedAt),
              eq(contracts.interestPaidUntil, draft.expectedPaidUntil),
              eq(contracts.outstandingPrincipal, draft.expectedOutstanding.toBigInt()),
            ),
          )
          .returning({ id: contracts.id });
        if (updated.length === 0) return false;
        const entries: CashEntry[] = [];
        if (interest) {
          entries.push({ type: "interest_payment", contractId, amount: interest.amount, periodFrom: interest.from, periodTo: interest.to });
        }
        entries.push({
          type: draft.direction === "repayment" ? "principal_repayment" : "additional_loan",
          contractId,
          amount: change.amount,
        });
        await this.appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate }, entries);
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: "contract",
          entityId: contractId,
          action: draft.direction === "repayment" ? "repay_principal" : "additional_loan",
          changedFields: interest && interest.to !== draft.expectedPaidUntil
            ? ["outstanding_principal", "interest_paid_until"]
            : ["outstanding_principal"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }

  async recordExtension(actor: Actor, draft: ExtensionDraft): Promise<boolean> {
    const { contractId, extension } = draft;
    const { interest } = extension;
    try {
      return await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(contracts)
          .set({ termDays: extension.termDaysAfter, ...(interest && { interestPaidUntil: interest.to }) })
          .where(
            and(
              eq(contracts.shopId, actor.shopId),
              eq(contracts.id, contractId),
              eq(contracts.status, "active"),
              isNull(contracts.deletedAt),
              eq(contracts.termDays, draft.expectedTermDays),
              eq(contracts.interestPaidUntil, draft.expectedPaidUntil),
              eq(contracts.outstandingPrincipal, draft.expectedOutstanding.toBigInt()),
            ),
          )
          .returning({ id: contracts.id });
        if (updated.length === 0) return false;
        if (interest) {
          await this.appendCashEntries(tx, { shopId: actor.shopId, createdBy: actor.userId, businessDate: draft.businessDate }, [
            { type: "interest_payment", contractId, amount: interest.amount, periodFrom: interest.from, periodTo: interest.to },
          ]);
        }
        await tx.insert(auditLogs).values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: "contract",
          entityId: contractId,
          action: "extend",
          changedFields: interest ? ["term_days", "interest_paid_until"] : ["term_days"],
        });
        return true;
      });
    } catch (error) {
      throw dbCause(error);
    }
  }
}

/** Cấp mã CD-n / TC-n: upsert khoá dòng bộ đếm tới hết transaction nên hai hợp đồng đồng thời không trùng mã. */
async function nextCode(tx: Tx, shopId: string, kind: ContractKind): Promise<string> {
  const prefix = CODE_PREFIX[kind];
  // `next_value` là số sẽ cấp tiếp theo: lần đầu chèn 2 và cấp 1, các lần sau tăng 1 và cấp giá trị cũ.
  const [row] = await tx
    .insert(shopCounters)
    .values({ shopId, prefix, nextValue: 2n })
    .onConflictDoUpdate({ target: [shopCounters.shopId, shopCounters.prefix], set: { nextValue: sql`${shopCounters.nextValue} + 1` } })
    .returning({ nextValue: shopCounters.nextValue });
  return `${prefix}${row.nextValue - 1n}`;
}

function rateFromDb(value: string): bigint {
  const rate = parseRate(value);
  if (rate === null) throw new Error("Lãi suất trong DB sai định dạng numeric(9,4)");
  return rate;
}
