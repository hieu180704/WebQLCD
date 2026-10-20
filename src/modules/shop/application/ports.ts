import type { Subscription } from "../domain/subscription";

export interface ShopRepository {
  findSubscription(shopId: string): Promise<Subscription | undefined>;
}
