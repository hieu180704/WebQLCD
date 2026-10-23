import type { Money } from "@/shared/kernel/money";
import { businessDate } from "@/shared/kernel/local-date";
import { planPayment, type PaymentViolation } from "../domain/installment";
import type { Actor, InstallmentRepository } from "./ports";

export type PayInstallmentInput = {
  contractId: string;
  /** Số đã thu người nhập đang thấy (khoá lạc quan); không dùng làm số tiền thu. */
  expectedPaid: Money;
  amount: Money;
};

export type PayInstallmentError = "not_found" | "closed" | "stale" | PaymentViolation;

export type PayInstallmentResult =
  { ok: true; amount: Money; paidAfter: Money; closed: boolean } | { ok: false; error: PayInstallmentError };

/** Đóng tiền góp (chủ tiệm và KTV): ghi một khoản thu vào sổ két hôm nay; thu đủ tổng phải thu thì hợp đồng tự đóng. */
export class PayInstallment {
  constructor(private readonly installments: InstallmentRepository) {}

  async execute(actor: Actor, input: PayInstallmentInput, now = new Date()): Promise<PayInstallmentResult> {
    const record = await this.installments.findRecord(actor.shopId, input.contractId);
    if (!record) return { ok: false, error: "not_found" };
    if (record.status === "closed") return { ok: false, error: "closed" };
    if (!record.amountPaid.equals(input.expectedPaid)) return { ok: false, error: "stale" };
    const plan = planPayment(record, input.amount);
    if (!plan.ok) return plan;
    const saved = await this.installments.recordPayment(actor, {
      contractId: input.contractId,
      kind: "pay",
      payment: plan.value,
      expectedPaid: record.amountPaid,
      businessDate: businessDate(now),
    });
    if (!saved) return { ok: false, error: "stale" };
    return { ok: true, amount: plan.value.amount, paidAfter: plan.value.paidAfter, closed: plan.value.closes };
  }
}
