import { businessDate } from "@/shared/kernel/local-date";
import { planDisbursement, type ContractRuleViolation, type ContractTerms } from "../domain/contract";
import type { Actor, ContractCustomer, ContractRepository, CreateContractRejection } from "./ports";

export type { ContractRuleViolation };

export type CreateContractError = ContractRuleViolation | CreateContractRejection;

export type CreateContractInput = { terms: ContractTerms; customer: ContractCustomer; staffId: string; note: string | null };

export type CreateContractResult =
  | { ok: true; code: string; reusedCustomerName: string | null }
  | { ok: false; error: CreateContractError };

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
      staffId: input.staffId,
      note: input.note,
      disbursement: plan.value,
      businessDate: today,
    });
    if (typeof created === "string") return { ok: false, error: created };
    // Khách có sẵn được chọn từ trang khách thì không cần báo "dùng lại khách cũ".
    const reused = created.customer.reused && !("existingId" in input.customer);
    return { ok: true, code: created.code, reusedCustomerName: reused ? created.customer.fullName : null };
  }
}
