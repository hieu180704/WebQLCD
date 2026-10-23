import type { NewCustomer } from "@/modules/customer";
import { businessDate } from "@/shared/kernel/local-date";
import { checkTerms, type InstallmentRuleViolation, type InstallmentTerms } from "../domain/installment";
import type { Actor, InstallmentRepository } from "./ports";

export type { InstallmentRuleViolation };

export type CreateInstallmentInput = { terms: InstallmentTerms; customer: NewCustomer; note: string | null };

export type CreateInstallmentResult =
  { ok: true; code: string; reusedCustomerName: string | null } | { ok: false; error: InstallmentRuleViolation };

/** Tạo hợp đồng trả góp và giải ngân: ghi khách, hợp đồng, sổ két, audit trong một transaction. */
export class CreateInstallment {
  constructor(private readonly installments: InstallmentRepository) {}

  async execute(actor: Actor, input: CreateInstallmentInput, now = new Date()): Promise<CreateInstallmentResult> {
    const today = businessDate(now);
    const error = checkTerms(input.terms, today);
    if (error) return { ok: false, error };
    const created = await this.installments.create(actor, {
      terms: input.terms,
      customer: input.customer,
      note: input.note,
      businessDate: today,
    });
    return { ok: true, code: created.code, reusedCustomerName: created.customer.reused ? created.customer.fullName : null };
  }
}
