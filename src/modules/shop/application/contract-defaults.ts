import type { Actor, ContractDefaults, ShopRepository } from "./ports";

export type { ContractDefaults };

export class GetContractDefaults {
  constructor(private readonly shops: ShopRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string): Promise<ContractDefaults> {
    const defaults = await this.shops.findContractDefaults(shopId);
    if (!defaults) throw new Error("Không tìm thấy cửa hàng của phiên đăng nhập");
    return defaults;
  }
}

/** Lưu mặc định tạo hợp đồng: chỉ chủ tiệm (guard kiểm ở server action). Kỳ lãi không dài hơn số ngày vay (core-spec mục 2). */
export class UpdateContractDefaults {
  constructor(private readonly shops: ShopRepository) {}

  async execute(actor: Actor, defaults: ContractDefaults): Promise<{ ok: true; changed: (keyof ContractDefaults)[] } | { ok: false }> {
    if (defaults.interestPeriodDays > defaults.termDays) return { ok: false };
    return { ok: true, changed: await this.shops.updateContractDefaults(actor, defaults) };
  }
}
