import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { auditLogs, shops } from "@/shared/infrastructure/db/schema";
import type { Actor, ShopInfo, ShopProfile, ShopRepository } from "../application/ports";
import type { Subscription } from "../domain/subscription";

const INFO_FIELDS = ["name", "phone", "address"] as const satisfies readonly (keyof ShopInfo)[];

export class DrizzleShopRepository implements ShopRepository {
  constructor(private readonly db: Db) {}

  async findSubscription(shopId: string): Promise<Subscription | undefined> {
    const [row] = await this.db
      .select({ status: shops.subscriptionStatus, trialEndsAt: shops.trialEndsAt, paidUntil: shops.paidUntil })
      .from(shops)
      .where(eq(shops.id, shopId));
    return row;
  }

  async findProfile(shopId: string): Promise<ShopProfile | undefined> {
    const [row] = await this.db
      .select({ name: shops.name, phone: shops.phone, address: shops.address, openedAt: shops.openedAt })
      .from(shops)
      .where(eq(shops.id, shopId));
    return row;
  }

  async updateInfo(actor: Actor, info: ShopInfo): Promise<(keyof ShopInfo)[]> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ name: shops.name, phone: shops.phone, address: shops.address })
        .from(shops)
        .where(eq(shops.id, actor.shopId))
        .for("update");
      if (!current) throw new Error("Không tìm thấy cửa hàng của phiên đăng nhập");
      const changed = INFO_FIELDS.filter((field) => current[field] !== info[field]);
      if (changed.length === 0) return changed;
      await tx.update(shops).set(info).where(eq(shops.id, actor.shopId));
      await tx.insert(auditLogs).values({
        shopId: actor.shopId,
        userId: actor.userId,
        entity: "shop",
        entityId: actor.shopId,
        action: "edit",
        changedFields: changed,
      });
      return changed;
    });
  }
}
