import { businessDate } from "@/shared/kernel/local-date";
import { isReversible } from "../domain/contract";
import type { Actor, ContractRepository } from "./ports";

export type ReverseOperationInput = {
  contractId: string;
  /** Thao tác mới nhất người dùng đang thấy; đã có thao tác mới hơn (hoặc vừa bị huỷ) thì từ chối. */
  operationId: string;
  reason: string;
};

export type ReverseOperationError = "not_found" | "stale" | "not_reversible";

export type ReverseOperationResult = { ok: true } | { ok: false; error: ReverseOperationError };

/** Huỷ thao tác mới nhất của hợp đồng (chỉ chủ tiệm, guard ở presentation): bút toán đảo ghi sổ két hôm nay. */
export class ReverseOperation {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: ReverseOperationInput, now = new Date()): Promise<ReverseOperationResult> {
    const latest = await this.contracts.findLatestOperation(actor.shopId, input.contractId);
    if (!latest) return { ok: false, error: "not_found" };
    if (latest.id !== input.operationId) return { ok: false, error: "stale" };
    if (!isReversible(latest.kind)) return { ok: false, error: "not_reversible" };
    const saved = await this.contracts.reverseOperation(actor, {
      contractId: input.contractId,
      operationId: latest.id,
      reason: input.reason,
      businessDate: businessDate(now),
    });
    return saved ? { ok: true } : { ok: false, error: "stale" };
  }
}
