import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { planInterestPayment, type InterestPaymentViolation } from "../domain/contract";
import type { Actor, ContractRepository } from "./ports";

export type PayInterestInput = {
  contractId: string;
  /** Số kỳ đóng (1 = đến hết kỳ kế tiếp). */
  periods: number;
  /** Ngày lãi đã trả đến mà người nhập đang thấy; khác DB thì từ chối (trang đã cũ hoặc bấm hai lần). */
  expectedPaidUntil: LocalDate;
  /** Số tiền khách đưa; null = đúng lãi tính được. */
  amount: Money | null;
};

export type PayInterestError = InterestPaymentViolation | "not_found" | "closed" | "stale";

export type PayInterestResult = { ok: true; paidUntil: LocalDate; amount: Money } | { ok: false; error: PayInterestError };

/** Đóng lãi hợp đồng cầm đồ/tín chấp: một dòng thu lãi vào sổ két hôm nay, dời ngày lãi đã trả đến. */
export class PayInterest {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: PayInterestInput, now = new Date()): Promise<PayInterestResult> {
    const today = businessDate(now);
    const standing = await this.contracts.findStanding(actor.shopId, input.contractId);
    if (!standing) return { ok: false, error: "not_found" };
    if (standing.status !== "active") return { ok: false, error: "closed" };
    if (standing.interestPaidUntil !== input.expectedPaidUntil) return { ok: false, error: "stale" };

    const plan = planInterestPayment(standing, today, input.periods, input.amount);
    if (!plan.ok) return plan;
    const saved = await this.contracts.recordInterestPayment(actor, {
      contractId: input.contractId,
      payment: plan.value,
      expectedOutstanding: standing.outstandingPrincipal,
      businessDate: today,
    });
    if (!saved) return { ok: false, error: "stale" };
    return { ok: true, paidUntil: plan.value.to, amount: plan.value.amount };
  }
}
