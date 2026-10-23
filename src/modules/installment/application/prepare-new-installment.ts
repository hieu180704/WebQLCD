import type { CustomerSummary, InstallmentRepository } from "./ports";

export type { CustomerSummary };

/** Khách có sẵn cho form tạo hợp đồng trả góp mở từ trang khách. */
export class PrepareNewInstallment {
  constructor(private readonly installments: InstallmentRepository) {}

  /** `shopId` lấy từ session (guard). `customerId` từ URL: không thuộc cửa hàng thì null. */
  async execute(shopId: string, customerId: string | null): Promise<CustomerSummary | null> {
    return customerId ? this.installments.findCustomerSummary(shopId, customerId) : null;
  }
}
