import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { planExtension, type ExtensionViolation } from "../domain/contract";
import type { Actor, ContractRepository } from "./ports";

export type ExtendContractInput = {
  contractId: string;
  extraDays: number;
  /** Số liệu người nhập đang thấy; khác DB hoặc đã sang ngày khác thì từ chối. */
  expectedTermDays: number;
  expectedPaidUntil: LocalDate;
  expectedOutstanding: Money;
  asOf: LocalDate;
  /** Tiền lãi thu kèm đến hôm nay; null = không thu lãi. */
  interest: Money | null;
};

export type ExtendContractError = ExtensionViolation | "not_found" | "closed" | "stale";

export type ExtendContractResult = { ok: true; termDays: number; interest: Money | null } | { ok: false; error: ExtendContractError };

/** Gia hạn hợp đồng: cộng số ngày vay, không đổi tiền két; có thu lãi thì ghi một dòng đóng lãi hôm nay. */
export class ExtendContract {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: ExtendContractInput, now = new Date()): Promise<ExtendContractResult> {
    const today = businessDate(now);
    const standing = await this.contracts.findStanding(actor.shopId, input.contractId);
    if (!standing) return { ok: false, error: "not_found" };
    if (standing.status !== "active") return { ok: false, error: "closed" };
    if (
      input.asOf !== today ||
      standing.termDays !== input.expectedTermDays ||
      standing.interestPaidUntil !== input.expectedPaidUntil ||
      !standing.outstandingPrincipal.equals(input.expectedOutstanding)
    ) {
      return { ok: false, error: "stale" };
    }

    const plan = planExtension(standing, today, input.extraDays, input.interest);
    if (!plan.ok) return plan;
    const saved = await this.contracts.recordExtension(actor, {
      contractId: input.contractId,
      extension: plan.value,
      expectedTermDays: standing.termDays,
      expectedPaidUntil: standing.interestPaidUntil,
      expectedOutstanding: standing.outstandingPrincipal,
      businessDate: today,
    });
    if (!saved) return { ok: false, error: "stale" };
    return { ok: true, termDays: plan.value.termDaysAfter, interest: plan.value.interest?.amount ?? null };
  }
}
