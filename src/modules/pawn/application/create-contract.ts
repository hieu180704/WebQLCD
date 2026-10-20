import type { NewCustomer } from "@/modules/customer";
import { businessDate } from "@/shared/kernel/local-date";
import { planDisbursement, type ContractRuleViolation, type ContractTerms } from "../domain/contract";
import type { Actor, ContractRepository } from "./ports";

export type { ContractRuleViolation };

export type CreateContractInput = { terms: ContractTerms; customer: NewCustomer; note: string | null };

export type CreateContractResult =
  | { ok: true; code: string; reusedCustomerName: string | null }
  | { ok: false; error: ContractRuleViolation };

/** Tạo hợp đồng cầm đồ/tín chấp và giải ngân: ghi khách, hợp đồng, sổ két, audit trong một transaction. */
export class CreateContract {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(actor: Actor, input: CreateContractInput, now = new Date()): Promise<CreateContractResult> {
    const today = businessDate(now);
    const plan = planDisbursement(input.terms, today);
    if (!plan.ok) return plan;
    const created = await this.contracts.create(actor, {
      terms: input.terms,
      customer: input.customer,
      note: input.note,
      disbursement: plan.value,
      businessDate: today,
    });
    return { ok: true, code: created.code, reusedCustomerName: created.customer.reused ? created.customer.fullName : null };
  }
}
