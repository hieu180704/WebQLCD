import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { auditLogs, shops } from "@/shared/infrastructure/db/schema";
import type { Actor, ContractDefaults, ShopInfo, ShopProfile, ShopRepository } from "../application/ports";
import type { Subscription } from "../domain/subscription";

const INFO_FIELDS = ["name", "phone", "address"] as const satisfies readonly (keyof ShopInfo)[];

// Tên cột ghi vào audit_logs.changed_fields.
const DEFAULT_AUDIT: Record<keyof ContractDefaults, string> = {
  interestType: "default_interest_type",
  interestRate: "default_interest_rate",
  termDays: "default_term_days",
  interestPeriodDays: "default_interest_period_days",
  prepaidInterest: "default_prepaid_interest",
};
const DEFAULT_FIELDS = Object.keys(DEFAULT_AUDIT) as (keyof ContractDefaults)[];

const defaultsSelection = {
  interestType: shops.defaultInterestType,
  interestRate: shops.defaultInterestRate,
  termDays: shops.defaultTermDays,
  interestPeriodDays: shops.defaultInterestPeriodDays,
  prepaidInterest: shops.defaultPrepaidInterest,
};

/** Cột numeric(9,4) trả "3.0000" → "3", "1.5000" → "1.5". */
const trimRate = (rate: string | null) => (rate === null ? null : rate.replace(/0+$/, "").replace(/\.$/, ""));

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

  async findContractDefaults(shopId: string): Promise<ContractDefaults | undefined> {
    const [row] = await this.db.select(defaultsSelection).from(shops).where(eq(shops.id, shopId));
    return row && { ...row, interestRate: trimRate(row.interestRate) };
  }

  async updateContractDefaults(actor: Actor, defaults: ContractDefaults): Promise<(keyof ContractDefaults)[]> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select(defaultsSelection).from(shops).where(eq(shops.id, actor.shopId)).for("update");
      if (!row) throw new Error("Không tìm thấy cửa hàng của phiên đăng nhập");
      const current = { ...row, interestRate: trimRate(row.interestRate) };
      const changed = DEFAULT_FIELDS.filter((field) => current[field] !== defaults[field]);
      if (changed.length === 0) return changed;
      await tx
        .update(shops)
        .set({
          defaultInterestType: defaults.interestType,
          defaultInterestRate: defaults.interestRate,
          defaultTermDays: defaults.termDays,
          defaultInterestPeriodDays: defaults.interestPeriodDays,
          defaultPrepaidInterest: defaults.prepaidInterest,
        })
        .where(eq(shops.id, actor.shopId));
      await tx.insert(auditLogs).values({
        shopId: actor.shopId,
        userId: actor.userId,
        entity: "shop",
        entityId: actor.shopId,
        action: "edit",
        changedFields: changed.map((field) => DEFAULT_AUDIT[field]),
      });
      return changed;
    });
  }
}
