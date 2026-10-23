// Đổi mật khẩu của chính mình trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của adapter thành savepoint bên trong.
import { TransactionRollbackError, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { THROTTLE_RULES } from "@/shared/infrastructure/auth/login-throttle";
import { verifyPassword } from "@/shared/infrastructure/auth/password";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import { DrizzleAccountRepository } from "./drizzle-account-repository";
import { ThrottledPasswordChanger } from "./throttled-password-changer";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("ThrottledPasswordChanger", () => {
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
  const IP = async () => "203.0.113.7";

  /** Chủ tiệm mới + 2 phiên của chính chủ tiệm; trả actor và id phiên hiện tại / phiên khác. */
  async function setup(db: Db) {
    const username = `doimk_${Date.now()}_${n++}`;
    await new DrizzleAccountRepository(db).registerOwner(
      {
        shopName: "Tiệm Test",
        ownerName: "Chủ Test",
        email: `${username}@example.com`,
        username,
        password: "matkhau123",
      },
      7,
    );
    const [user] = await db
      .select({ id: schema.users.id, shopId: schema.users.shopId })
      .from(schema.users)
      .where(eq(schema.users.username, username));
    const expiresAt = new Date(Date.now() + 3_600_000);
    const [current, other] = await db
      .insert(schema.sessions)
      .values([
        { userId: user.id, token: `t_${username}_1`, expiresAt },
        { userId: user.id, token: `t_${username}_2`, expiresAt },
      ])
      .returning({ id: schema.sessions.id });
    return {
      username,
      actor: { userId: user.id, shopId: user.shopId },
      current: current.id,
      other: other.id,
    };
  }

  async function storedHash(db: Db, userId: string) {
    const [row] = await db
      .select({ password: schema.accounts.password })
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, userId));
    return row.password!;
  }

  it("đúng mật khẩu hiện tại: đổi mật khẩu, giữ phiên hiện tại, xoá phiên khác, có audit", () =>
    inTx(async (db) => {
      const { actor, current, other } = await setup(db);
      const changer = new ThrottledPasswordChanger(db, IP);
      expect(
        await changer.changeOwnPassword(actor, current, {
          currentPassword: "matkhau123",
          newPassword: "matkhaumoi789",
        }),
      ).toBe("ok");

      expect(
        await verifyPassword(
          await storedHash(db, actor.userId),
          "matkhaumoi789",
        ),
      ).toBe(true);
      const { rows: left } = await db.execute<{ id: string }>(
        sql`SELECT id FROM sessions WHERE user_id = ${actor.userId}`,
      );
      expect(left.map((r) => r.id)).toEqual([current]);
      expect(left.map((r) => r.id)).not.toContain(other);
      const { rows } = await db.execute<{ action: string }>(
        sql`SELECT action FROM audit_logs WHERE entity = 'user' AND entity_id = ${actor.userId} AND action = 'change_password'`,
      );
      expect(rows).toHaveLength(1);
    }));

  it("sai mật khẩu hiện tại: không đổi gì; sai quá số lần thì khoá cả lần nhập đúng", () =>
    inTx(async (db) => {
      const { actor, current } = await setup(db);
      const changer = new ThrottledPasswordChanger(db, IP);
      const before = await storedHash(db, actor.userId);
      const wrong = {
        currentPassword: "saimatkhau",
        newPassword: "matkhaumoi789",
      };

      for (let i = 0; i < THROTTLE_RULES.user.maxAttempts; i++) {
        expect(await changer.changeOwnPassword(actor, current, wrong)).toBe(
          "wrong_password",
        );
      }
      expect(
        await changer.changeOwnPassword(actor, current, {
          ...wrong,
          currentPassword: "matkhau123",
        }),
      ).toBe("locked");
      expect(await storedHash(db, actor.userId)).toBe(before);
      const { rows } = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${actor.userId}`,
      );
      expect(rows[0].n).toBe(2);
    }));

  it("actor mang shopId của cửa hàng khác thì không tìm thấy tài khoản, không đổi được", () =>
    inTx(async (db) => {
      const a = await setup(db);
      const b = await setup(db);
      const changer = new ThrottledPasswordChanger(db, IP);
      await expect(
        changer.changeOwnPassword(
          { userId: a.actor.userId, shopId: b.actor.shopId },
          a.current,
          { currentPassword: "matkhau123", newPassword: "matkhaumoi789" },
        ),
      ).rejects.toThrow();
      expect(
        await verifyPassword(
          await storedHash(db, a.actor.userId),
          "matkhau123",
        ),
      ).toBe(true);
    }));
});
