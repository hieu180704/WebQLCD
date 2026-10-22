import type {
  Actor,
  CustomerEditDraft,
  CustomerRepository,
  EditCustomerResult,
} from "./ports";

/**
 * Sửa thông tin khách (core-spec mục 2): không sinh giao dịch, ghi audit `edit`. CCCD để trống thì giữ nguyên;
 * CCCD trùng khách khác trong cửa hàng thì từ chối. Chủ tiệm và KTV đều sửa được (guard ở presentation).
 */
export class EditCustomer {
  constructor(private readonly customers: CustomerRepository) {}

  execute(actor: Actor, draft: CustomerEditDraft): Promise<EditCustomerResult> {
    return this.customers.recordEdit(actor, draft);
  }
}

export type RevealCccdResult =
  { ok: true; cccd: string } | { ok: false; error: "not_found" | "no_cccd" };

/** Xem CCCD đầy đủ: chỉ chủ tiệm (guard ở presentation), mỗi lần xem ghi audit. */
export class RevealCccd {
  constructor(private readonly customers: CustomerRepository) {}

  async execute(actor: Actor, customerId: string): Promise<RevealCccdResult> {
    const found = await this.customers.revealCccd(actor, customerId);
    if (!found) return { ok: false, error: "not_found" };
    return found.cccd
      ? { ok: true, cccd: found.cccd }
      : { ok: false, error: "no_cccd" };
  }
}
