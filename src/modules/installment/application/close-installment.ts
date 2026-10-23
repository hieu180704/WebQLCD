import { businessDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { planSettlement, type SettlementViolation } from "../domain/installment";
import type { Actor, InstallmentRepository } from "./ports";

export type CloseInstallmentInput = {
  contractId: string;
  /** Số đã thu người nhập đang thấy (khoá lạc quan); không dùng làm số tiền thu. */
  expectedPaid: Money;
  /** Số tiền thu để tất toán; được thấp hơn số còn phải thu, kể cả 0. */
  amount: Money;
};

export type CloseInstallmentError = "not_found" | "closed" | "stale" | SettlementViolation;

export type CloseInstallmentResult = { ok: true; amount: Money; discount: Money } | { ok: false; error: CloseInstallmentError };

/** Đóng / tất toán hợp đồng trả góp (chủ tiệm và KTV): thu phần còn lại (được giảm) rồi chuyển "Đã đóng". */
export class CloseInstallment {
  constructor(private readonly installments: InstallmentRepository) {}

  async execute(actor: Actor, input: CloseInstallmentInput, now = new Date()): Promise<CloseInstallmentResult> {
    const record = await this.installments.findRecord(actor.shopId, input.contractId);
    if (!record) return { ok: false, error: "not_found" };
    if (record.status === "closed") return { ok: false, error: "closed" };
    if (!record.amountPaid.equals(input.expectedPaid)) return { ok: false, error: "stale" };
    const plan = planSettlement(record, input.amount);
    if (!plan.ok) return plan;
    const saved = await this.installments.recordPayment(actor, {
      contractId: input.contractId,
      kind: "close",
      payment: plan.value,
      expectedPaid: record.amountPaid,
      businessDate: businessDate(now),
    });
    if (!saved) return { ok: false, error: "stale" };
    return { ok: true, amount: plan.value.amount, discount: record.totalDue.subtract(plan.value.paidAfter) };
  }
}
