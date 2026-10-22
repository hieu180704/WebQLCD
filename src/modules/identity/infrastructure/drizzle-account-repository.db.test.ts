// Repository tài khoản trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của repository thành savepoint bên trong.
import { TransactionRollbackError, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@/shared/infrastructure/auth/password";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import type { OwnerRegistration } from "../application/ports";
import { DrizzleAccountRepository } from "./drizzle-account-repository";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("DrizzleAccountRepository", () => {
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
  const owner = (overrides: Partial<OwnerRegistration> = {}): OwnerRegistration => {
    const id = `repo_${Date.now()}_${n++}`;
    return { shopName: "Tiệm Test", ownerName: "Chủ Test", email: `${id}@example.com`, username: id, password: "matkhau123", ...overrides };
  };

  async function findUser(db: Db, username: string) {
    const [row] = await db
      .select({
        id: schema.users.id,
        shopId: schema.users.shopId,
        role: schema.users.role,
        username: schema.users.username,
        displayUsername: schema.users.displayUsername,
        email: schema.users.email,
        password: schema.accounts.password,
        providerId: schema.accounts.providerId,
        accountId: schema.accounts.accountId,
      })
      .from(schema.users)
      .innerJoin(schema.accounts, eq(schema.accounts.userId, schema.users.id))
      .where(sql`lower(${schema.users.username}) = lower(${username})`);
    return row;
  }

  it("đăng ký: cửa hàng dùng thử N ngày, chủ tiệm có tài khoản credential đúng hình dạng Better Auth", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const input = owner({ username: `Repo_Hoa_${n++}` });
      expect(await repo.registerOwner(input, 7)).toBe("ok");

      const user = await findUser(db, input.username);
      expect(user).toMatchObject({
        role: "owner",
        username: input.username.toLowerCase(),
        displayUsername: input.username,
        email: input.email,
        providerId: "credential",
        accountId: user.id,
      });
      expect(await verifyPassword(user.password!, input.password)).toBe(true);

      const { rows } = await db.execute<{ trial_days: number; opened_today: boolean; status: string }>(
        sql`SELECT
          round(extract(epoch FROM trial_ends_at - now()) / 86400)::int AS trial_days,
          opened_at = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS opened_today,
          subscription_status AS status
        FROM shops WHERE id = ${user.shopId}`,
      );
      expect(rows[0]).toEqual({ trial_days: 7, opened_today: true, status: "trial" });
    }));

  it("trùng tên đăng nhập (khác hoa thường) hoặc email: báo đúng lỗi, không để lại cửa hàng mồ côi", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const first = owner();
      await repo.registerOwner(first, 7);
      const countShops = async () =>
        (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM shops`)).rows[0].n;
      const before = await countShops();

      expect(await repo.registerOwner(owner({ username: first.username.toUpperCase() }), 7)).toBe("username_taken");
      expect(await repo.registerOwner(owner({ email: first.email }), 7)).toBe("email_taken");
      expect(await countShops()).toBe(before);
    }));

  it("KTV: thuộc cửa hàng của người tạo, email nội bộ .invalid, có audit; cửa hàng khác không thấy", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);

      const staffName = `ktv_${Date.now()}_${n++}`;
      expect(await repo.createStaff({ userId: ownerA.id, shopId: ownerA.shopId }, { name: "KTV Lan", username: staffName, password: "matkhau456" })).toBe("ok");
      const staff = await findUser(db, staffName);
      expect(staff).toMatchObject({ shopId: ownerA.shopId, role: "staff", providerId: "credential" });
      expect(staff.email).toMatch(/^staff-[0-9a-f-]{36}@tp83\.invalid$/);

      const { rows } = await db.execute<{ user_id: string; action: string }>(
        sql`SELECT user_id, action FROM audit_logs WHERE entity = 'user' AND entity_id = ${staff.id}`,
      );
      expect(rows).toEqual([{ user_id: ownerA.id, action: "create" }]);

      expect((await repo.listStaff(ownerA.shopId, 10)).map((s) => s.username)).toEqual([staffName]);
      expect(await repo.listStaff(ownerB.shopId, 10)).toEqual([]);
      expect(await repo.createStaff({ userId: ownerB.id, shopId: ownerB.shopId }, { name: "Trùng", username: staffName, password: "matkhau456" })).toBe(
        "username_taken",
      );
    }));

  it("người thực hiện không thuộc cửa hàng thì không tạo được KTV", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);
      const staffName = `ktv_${Date.now()}_${n++}`;

      await expect(
        repo.createStaff({ userId: ownerA.id, shopId: ownerB.shopId }, { name: "Lạ", username: staffName, password: "matkhau456" }),
      ).rejects.toThrow();
      expect(await findUser(db, staffName)).toBeUndefined();
    }));

  it("khoá KTV: xoá mọi phiên, có audit; mở khoá lại được; khoá lần hai báo not_found", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      await repo.registerOwner(a, 7);
      const ownerA = await findUser(db, a.username);
      const actor = { userId: ownerA.id, shopId: ownerA.shopId };
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff(actor, { name: "KTV Khoá", username: staffName, password: "matkhau456" });
      const staff = await findUser(db, staffName);
      const session = (userId: string) => ({ userId, token: `t_${Date.now()}_${n++}`, expiresAt: new Date(Date.now() + 3_600_000) });
      await db.insert(schema.sessions).values([session(staff.id), session(staff.id), session(ownerA.id)]);
      const countSessions = async (userId: string) =>
        (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${userId}`)).rows[0].n;
      const isActive = async () => (await repo.listStaff(ownerA.shopId, 10))[0].isActive;

      expect(await repo.setStaffActive(actor, staff.id, false)).toBe("ok");
      expect(await isActive()).toBe(false);
      expect(await countSessions(staff.id)).toBe(0);
      expect(await countSessions(ownerA.id)).toBe(1);
      expect(await repo.setStaffActive(actor, staff.id, false)).toBe("not_found");

      expect(await repo.setStaffActive(actor, staff.id, true)).toBe("ok");
      expect(await isActive()).toBe(true);

      const { rows } = await db.execute<{ user_id: string; action: string }>(
        sql`SELECT user_id, action FROM audit_logs WHERE entity = 'user' AND entity_id = ${staff.id} ORDER BY id`,
      );
      expect(rows).toEqual([
        { user_id: ownerA.id, action: "create" },
        { user_id: ownerA.id, action: "lock" },
        { user_id: ownerA.id, action: "unlock" },
      ]);
    }));

  it("khoá: không đụng được chủ tiệm, không đụng được KTV cửa hàng khác", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);
      const actorA = { userId: ownerA.id, shopId: ownerA.shopId };
      const actorB = { userId: ownerB.id, shopId: ownerB.shopId };
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff(actorA, { name: "KTV A", username: staffName, password: "matkhau456" });
      const staffA = await findUser(db, staffName);

      expect(await repo.setStaffActive(actorA, ownerA.id, false)).toBe("not_found");
      expect(await repo.setStaffActive(actorB, staffA.id, false)).toBe("not_found");
      // Giả mạo shopId của cửa hàng A với người thực hiện thuộc cửa hàng B: khoá ngoại audit chặn, cả transaction rollback.
      await expect(repo.setStaffActive({ userId: ownerB.id, shopId: ownerA.shopId }, staffA.id, false)).rejects.toThrow();
      expect((await repo.listStaff(ownerA.shopId, 10))[0].isActive).toBe(true);
    }));
});
