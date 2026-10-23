import type { Actor, ShopInfo, ShopProfile, ShopRepository } from "./ports";

export type { ShopInfo, ShopProfile };

export class GetShopProfile {
  constructor(private readonly shops: ShopRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string): Promise<ShopProfile> {
    const profile = await this.shops.findProfile(shopId);
    if (!profile) throw new Error("Không tìm thấy cửa hàng của phiên đăng nhập");
    return profile;
  }
}

/** Sửa tên, SĐT, địa chỉ cửa hàng: chỉ chủ tiệm (guard kiểm ở server action). Không sinh giao dịch. */
export class UpdateShopInfo {
  constructor(private readonly shops: ShopRepository) {}

  execute(actor: Actor, info: ShopInfo): Promise<(keyof ShopInfo)[]> {
    return this.shops.updateInfo(actor, info);
  }
}
