import { businessDate } from "@/shared/kernel/local-date";
import type { Actor, InstallmentRepository } from "./ports";

export type DeleteInstallmentInput = {
  contractId: string;
  /** Mã hợp đồng người dùng gõ lại để xác nhận. */
  confirmCode: string;
  reason: string;
};

export type DeleteInstallmentError = "not_found" | "code_mismatch";

export type DeleteInstallmentResult = { ok: true; code: string } | { ok: false; error: DeleteInstallmentError };

/** Xoá hợp đồng trả góp (chỉ chủ tiệm, guard ở presentation): xoá mềm, đảo mọi giao dịch vào sổ két hôm nay. */
export class DeleteInstallment {
  constructor(private readonly installments: InstallmentRepository) {}

  async execute(actor: Actor, input: DeleteInstallmentInput, now = new Date()): Promise<DeleteInstallmentResult> {
    const record = await this.installments.findRecord(actor.shopId, input.contractId);
    if (!record) return { ok: false, error: "not_found" };
    if (input.confirmCode.trim().toUpperCase() !== record.code.toUpperCase()) return { ok: false, error: "code_mismatch" };
    const saved = await this.installments.deleteContract(actor, {
      contractId: input.contractId,
      reason: input.reason,
      businessDate: businessDate(now),
    });
    return saved ? { ok: true, code: record.code } : { ok: false, error: "not_found" };
  }
}
