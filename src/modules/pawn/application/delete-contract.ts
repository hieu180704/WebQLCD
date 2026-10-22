import { businessDate } from "@/shared/kernel/local-date";
import type { Actor, ContractRepository } from "./ports";

export type DeleteContractInput = {
  contractId: string;
  /** Mã hợp đồng người dùng gõ lại để xác nhận. */
  confirmCode: string;
  reason: string;
};

export type DeleteContractError = "not_found" | "code_mismatch";

export type DeleteContractResult = { ok: true; code: string } | { ok: false; error: DeleteContractError };

/** Xoá hợp đồng (chỉ chủ tiệm, guard ở presentation): xoá mềm, đảo mọi giao dịch vào sổ két hôm nay. */
export class DeleteContract {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: DeleteContractInput, now = new Date()): Promise<DeleteContractResult> {
    const standing = await this.contracts.findStanding(actor.shopId, input.contractId);
    if (!standing) return { ok: false, error: "not_found" };
    if (input.confirmCode.trim().toUpperCase() !== standing.code.toUpperCase()) return { ok: false, error: "code_mismatch" };
    const saved = await this.contracts.deleteContract(actor, {
      contractId: input.contractId,
      reason: input.reason,
      businessDate: businessDate(now),
    });
    return saved ? { ok: true, code: standing.code } : { ok: false, error: "not_found" };
  }
}
