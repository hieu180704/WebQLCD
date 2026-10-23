import { businessDate } from "@/shared/kernel/local-date";
import { isReversible } from "../domain/installment";
import type { Actor, InstallmentRepository } from "./ports";

export type ReverseInstallmentOperationInput = {
  contractId: string;
  /** Thao tác mới nhất người dùng đang thấy; đã có thao tác mới hơn (hoặc vừa bị huỷ) thì từ chối. */
  operationId: string;
  reason: string;
};

export type ReverseInstallmentOperationError = "not_found" | "stale" | "not_reversible";

export type ReverseInstallmentOperationResult = { ok: true } | { ok: false; error: ReverseInstallmentOperationError };

/** Huỷ thao tác mới nhất của hợp đồng trả góp (chỉ chủ tiệm, guard ở presentation): bút toán đảo ghi sổ két hôm nay. */
export class ReverseInstallmentOperation {
  constructor(private readonly installments: InstallmentRepository) {}

  async execute(actor: Actor, input: ReverseInstallmentOperationInput, now = new Date()): Promise<ReverseInstallmentOperationResult> {
    const latest = await this.installments.findLatestOperation(actor.shopId, input.contractId);
    if (!latest) return { ok: false, error: "not_found" };
    if (latest.id !== input.operationId) return { ok: false, error: "stale" };
    if (!isReversible(latest.kind)) return { ok: false, error: "not_reversible" };
    const saved = await this.installments.reverseOperation(actor, {
      contractId: input.contractId,
      operationId: latest.id,
      reason: input.reason,
      businessDate: businessDate(now),
    });
    return saved ? { ok: true } : { ok: false, error: "stale" };
  }
}
