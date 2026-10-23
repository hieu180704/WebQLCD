import type { ContractRepository, CustomerSummary, StaffOption } from "./ports";

export type { CustomerSummary, StaffOption };

export type NewContractContext = { staff: StaffOption[]; customer: CustomerSummary | null };

/** Dữ liệu cho form tạo hợp đồng: danh sách KTV chọn được, khách có sẵn (nếu mở từ trang khách). */
export class PrepareNewContract {
  constructor(private readonly contracts: ContractRepository) {}

  /** `shopId` lấy từ session (guard). `customerId` từ URL: không thuộc cửa hàng thì `customer` là null. */
  async execute(shopId: string, customerId: string | null): Promise<NewContractContext> {
    const [staff, customer] = await Promise.all([
      this.contracts.listStaffOptions(shopId),
      customerId ? this.contracts.findCustomerSummary(shopId, customerId) : null,
    ]);
    return { staff, customer };
  }
}
