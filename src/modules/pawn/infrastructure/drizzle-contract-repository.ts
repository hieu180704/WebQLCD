import "server-only";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { AppendCashEntries, CashEntry } from "@/modules/cashbook";
import { maskPhone, type DrizzleCustomerWriter } from "@/modules/customer";
import type { Db, Tx } from "@/shared/infrastructure/db/client";
import { dbCause } from "@/shared/infrastructure/db/errors";
import { auditLogs, contracts, customers, shopCounters } from "@/shared/infrastructure/db/schema";
import { Money } from "@/shared/kernel/money";
import { CODE_PREFIX, type ContractKind } from "../domain/contract";
import { formatRate, parseRate } from "../domain/interest/rate";
import type { Actor, ContractDraft, ContractListRow, ContractRepository, CreatedContract } from "../application/ports";

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
