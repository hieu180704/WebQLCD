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

  it("mặc định tạo hợp đồng: giá trị ban đầu, sửa chỉ cửa hàng mình, lãi trả về dạng gọn, audit tên cột", async () => {
    await inTx(async (db) => {
      const repo = new DrizzleShopRepository(db);
      const a = await ownerOf(db, "Tiệm A");
      const b = await ownerOf(db, "Tiệm B");
      const initial = {
        interestType: "per_million_per_day",
        interestRate: null,
        termDays: 30,
        interestPeriodDays: 10,
        prepaidInterest: false,
      };
      expect(await repo.findContractDefaults(a.shopId)).toEqual(initial);

      const next = {
        interestType: "percent_per_month",
        interestRate: "1.5",
        termDays: 60,
        interestPeriodDays: 15,
        prepaidInterest: true,
      } as const;
      expect(await repo.updateContractDefaults(a, next)).toEqual([
        "interestType",
        "interestRate",
        "termDays",
        "interestPeriodDays",
        "prepaidInterest",
      ]);
      expect(await repo.findContractDefaults(a.shopId)).toEqual(next);
      expect(await repo.findContractDefaults(b.shopId)).toEqual(initial);
      expect(await repo.updateContractDefaults(a, { ...next, interestRate: "3" })).toEqual(["interestRate"]);
      expect(await repo.updateContractDefaults(a, { ...next, interestRate: "3" })).toEqual([]);

      const audits = await db
        .select({ changedFields: schema.auditLogs.changedFields })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.entityId, a.shopId))
        .orderBy(schema.auditLogs.id); // uuidv7 tăng dần; `at` trùng nhau trong một transaction.
      expect(audits.map((row) => row.changedFields)).toEqual([
        ["default_interest_type", "default_interest_rate", "default_term_days", "default_interest_period_days", "default_prepaid_interest"],
        ["default_interest_rate"],
      ]);
    });
  });

  it("DB chặn kỳ lãi dài hơn số ngày vay", async () => {
    await inTx(async (db) => {
      const repo = new DrizzleShopRepository(db);
      const a = await ownerOf(db, "Tiệm A");
      await expect(
        repo.updateContractDefaults(a, {
          interestType: "per_million_per_day",
          interestRate: null,
          termDays: 10,
          interestPeriodDays: 11,
          prepaidInterest: false,
        }),
      ).rejects.toThrow();
    });
  });
});
