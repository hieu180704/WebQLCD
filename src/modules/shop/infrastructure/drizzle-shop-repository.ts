import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { shops } from "@/shared/infrastructure/db/schema";
import type { ShopRepository } from "../application/ports";
import type { Subscription } from "../domain/subscription";

export class DrizzleShopRepository implements ShopRepository {
  constructor(private readonly db: Db) {}

  async findSubscription(shopId: string): Promise<Subscription | undefined> {
    const [row] = await this.db
      .select({ status: shops.subscriptionStatus, trialEndsAt: shops.trialEndsAt, paidUntil: shops.paidUntil })
      .from(shops)
      .where(eq(shops.id, shopId));
    return row;
  }
}
