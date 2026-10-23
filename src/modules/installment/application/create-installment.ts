import { businessDate } from "@/shared/kernel/local-date";
import { checkTerms, type InstallmentRuleViolation, type InstallmentTerms } from "../domain/installment";
import type { Actor, InstallmentCustomer, InstallmentRepository } from "./ports";

export type CreateInstallmentError = InstallmentRuleViolation | "customer_not_found";

export type CreateInstallmentInput = { terms: InstallmentTerms; customer: InstallmentCustomer; note: string | null };

export type CreateInstallmentResult =
  { ok: true; code: string; reusedCustomerName: string | null } | { ok: false; error: CreateInstallmentError };

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
    if (created === "customer_not_found") return { ok: false, error: created };
    // Báo "khách cũ" chỉ khi trùng CCCD lúc nhập khách mới; khách chọn sẵn từ trang khách thì không.
    const reused = created.customer.reused && !("existingId" in input.customer);
    return { ok: true, code: created.code, reusedCustomerName: reused ? created.customer.fullName : null };
  }
}
