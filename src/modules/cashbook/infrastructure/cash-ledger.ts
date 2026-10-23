import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "@/shared/infrastructure/db/client";
import { cashTransactions } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";
import { signedAmount, type CashEntry } from "../domain/cash-entry";

export type CashOperation = {
  shopId: string;
  createdBy: string;
  businessDate: LocalDate;
  /** Id thao tác của bên gọi (vd. `contract_operations.id`); bỏ trống thì sinh mới. */
  operationId?: string;
  /** Ghi chú cho mọi dòng, vd. lý do huỷ. */
  note?: string;
};

export type AppendCashEntries = typeof appendCashEntries;

/**
 * Ghi các bút toán của MỘT thao tác vào sổ két, trong transaction của bên gọi (architecture-spec mục 2.2).
 * Các dòng chung `operation_id` để huỷ thao tác thì đảo được cả nhóm (data-model mục 2.5).
 */
export async function appendCashEntries(tx: Tx, operation: CashOperation, entries: readonly CashEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const operationId = operation.operationId ?? randomUUID();
  await tx.insert(cashTransactions).values(
    entries.map((entry) => ({
      shopId: operation.shopId,
      operationId,
      businessDate: operation.businessDate,
      amount: signedAmount(entry).toBigInt(),
      type: entry.type,
      contractId: "contractId" in entry ? entry.contractId : null,
      installmentContractId: "installmentContractId" in entry ? (entry.installmentContractId ?? null) : null,
      periodFrom: entry.type === "interest_payment" ? entry.periodFrom : null,
      periodTo: entry.type === "interest_payment" ? entry.periodTo : null,
      reversesId: entry.type === "reversal" ? entry.reversesId : null,
      note: operation.note ?? null,
      createdBy: operation.createdBy,
    })),
  );
}
