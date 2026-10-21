import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { planAdditionalLoan, planPrincipalRepayment, type PrincipalChangeViolation } from "../domain/contract";
import type { Actor, ContractRepository, PrincipalChangeDraft } from "./ports";

export type ChangePrincipalInput = {
  contractId: string;
  direction: PrincipalChangeDraft["direction"];
  /** Số liệu người nhập đang thấy; khác DB hoặc đã sang ngày khác thì từ chối (lãi thu kèm đã đổi). */
  expectedPaidUntil: LocalDate;
  expectedOutstanding: Money;
  asOf: LocalDate;
  /** Số tiền trả bớt / vay thêm. */
  amount: Money;
  /** Tiền lãi thu kèm; null = đúng lãi tính được. */
  interest: Money | null;
};

export type ChangePrincipalError = PrincipalChangeViolation | "not_found" | "closed" | "stale";

export type ChangePrincipalResult =
  | { ok: true; outstandingAfter: Money; interest: Money | null }
  | { ok: false; error: ChangePrincipalError };

/** Trả bớt gốc (thu vào két) / vay thêm (chi ra két), kèm lãi thu cùng thao tác, ghi sổ két hôm nay. */
export class ChangePrincipal {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: ChangePrincipalInput, now = new Date()): Promise<ChangePrincipalResult> {
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

    const plan = (input.direction === "repayment" ? planPrincipalRepayment : planAdditionalLoan)(
      standing,
      today,
      input.amount,
      input.interest,
    );
    if (!plan.ok) return plan;
    const saved = await this.contracts.recordPrincipalChange(actor, {
      contractId: input.contractId,
      direction: input.direction,
      change: plan.value,
      expectedPaidUntil: standing.interestPaidUntil,
      expectedOutstanding: standing.outstandingPrincipal,
      businessDate: today,
    });
    if (!saved) return { ok: false, error: "stale" };
    return { ok: true, outstandingAfter: plan.value.outstandingAfter, interest: plan.value.interest?.amount ?? null };
  }
}
