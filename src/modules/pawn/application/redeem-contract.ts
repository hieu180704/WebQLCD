import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { planRedemption, type RedemptionViolation } from "../domain/contract";
import type { Actor, ContractRepository } from "./ports";

export type RedeemContractInput = {
  contractId: string;
  /** Số liệu người nhập đang thấy; khác DB hoặc đã sang ngày khác thì từ chối (số tiền phải thu đã đổi). */
  expectedPaidUntil: LocalDate;
  expectedOutstanding: Money;
  asOf: LocalDate;
  /** Tiền lãi thu; null = đúng lãi đến hôm nay. */
  interest: Money | null;
};

export type RedeemContractError = RedemptionViolation | "not_found" | "closed" | "stale";

export type RedeemContractResult = { ok: true; total: Money } | { ok: false; error: RedeemContractError };

/** Chuộc đồ (cầm đồ) / đóng hợp đồng (tín chấp): thu lãi đến hôm nay + gốc còn lại vào sổ két hôm nay, đóng hợp đồng. */
export class RedeemContract {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: RedeemContractInput, now = new Date()): Promise<RedeemContractResult> {
    const today = businessDate(now);
    const standing = await this.contracts.findStanding(actor.shopId, input.contractId);
    if (!standing) return { ok: false, error: "not_found" };
    if (standing.status !== "active") return { ok: false, error: "closed" };
    if (
      input.asOf !== today ||
      standing.interestPaidUntil !== input.expectedPaidUntil ||
      !standing.outstandingPrincipal.equals(input.expectedOutstanding)
    ) {
      return { ok: false, error: "stale" };
    }

    const plan = planRedemption(standing, today, input.interest);
    if (!plan.ok) return plan;
    const saved = await this.contracts.recordRedemption(actor, {
      contractId: input.contractId,
      redemption: plan.value,
      expectedPaidUntil: standing.interestPaidUntil,
      businessDate: today,
    });
    if (!saved) return { ok: false, error: "stale" };
    const { interest, principal } = plan.value;
    return { ok: true, total: interest ? principal.add(interest.amount) : principal };
  }
}
