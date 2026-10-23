// Repository cửa hàng trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của repository thành savepoint bên trong.
import { TransactionRollbackError, and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import type { Actor } from "../application/ports";
import { DrizzleShopRepository } from "./drizzle-shop-repository";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("DrizzleShopRepository", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inTx(fn: (db: Db) => Promise<void>) {
    const db = drizzle({ client: pool, schema });
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as Db);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  }

  let n = 0;
  async function ownerOf(db: Db, name: string): Promise<Actor> {
    const [shop] = await db
      .insert(schema.shops)
      .values({ name, openedAt: "2026-10-01", trialEndsAt: new Date(Date.now() + 86_400_000) })
      .returning({ id: schema.shops.id });
    const id = `shop_repo_${Date.now()}_${n++}`;
    const [user] = await db
      .insert(schema.users)
      .values({ shopId: shop.id, name: "Chủ", email: `${id}@example.com`, username: id, role: "owner" })
      .returning({ id: schema.users.id });
    return { userId: user.id, shopId: shop.id };
  }

  it("sửa thông tin chỉ đụng cửa hàng của người thực hiện, ghi audit các field đã đổi", async () => {
    await inTx(async (db) => {
      const repo = new DrizzleShopRepository(db);
      const a = await ownerOf(db, "Tiệm A");
      const b = await ownerOf(db, "Tiệm B");

      const changed = await repo.updateInfo(a, { name: "Tiệm A mới", phone: "0283456789", address: null });
      expect(changed).toEqual(["name", "phone"]);
      expect(await repo.findProfile(a.shopId)).toEqual({ name: "Tiệm A mới", phone: "0283456789", address: null, openedAt: "2026-10-01" });
      expect(await repo.findProfile(b.shopId)).toMatchObject({ name: "Tiệm B", phone: null });

      const audits = await db
        .select({ userId: schema.auditLogs.userId, changedFields: schema.auditLogs.changedFields })
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.entity, "shop"), eq(schema.auditLogs.action, "edit"), eq(schema.auditLogs.entityId, a.shopId)));
      expect(audits).toEqual([{ userId: a.userId, changedFields: ["name", "phone"] }]);
    });
  });

  it("không đổi gì thì không ghi audit", async () => {
    await inTx(async (db) => {
      const repo = new DrizzleShopRepository(db);
      const a = await ownerOf(db, "Tiệm A");
      expect(await repo.updateInfo(a, { name: "Tiệm A", phone: null, address: null })).toEqual([]);
      const audits = await db.select({ id: schema.auditLogs.id }).from(schema.auditLogs).where(eq(schema.auditLogs.entityId, a.shopId));
      expect(audits).toEqual([]);
    });
  });
});
