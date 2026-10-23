import { describeSubscription, type SubscriptionView } from "../domain/subscription";
import type { ShopRepository } from "./ports";

export type { SubscriptionView };

export class GetSubscription {
  constructor(private readonly shops: Pick<ShopRepository, "findSubscription">) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  async execute(shopId: string, now = new Date()): Promise<SubscriptionView> {
    const subscription = await this.shops.findSubscription(shopId);
    if (!subscription) throw new Error("Không tìm thấy cửa hàng của phiên đăng nhập");
    return describeSubscription(subscription, now);
  }
}
