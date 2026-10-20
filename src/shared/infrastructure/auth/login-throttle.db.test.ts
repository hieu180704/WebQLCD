// Khoá đăng nhập trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi ROLLBACK.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { THROTTLE_RULES, releaseLoginAttempt, reserveLoginAttempt } from "./login-throttle";

type Db = NodePgDatabase<Record<string, unknown>>;

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("khoá đăng nhập", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inTx(fn: (db: Db, c: PoolClient) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await fn(drizzle({ client: c }), c);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }

  const fail = async (db: Db, username: string, ip: string | null, times: number) => {
    const results: boolean[] = [];
    for (let i = 0; i < times; i++) results.push(await reserveLoginAttempt(db, { username, ip }));
    return results;
  };

  it("sai 5 lần thì lần thứ 6 bị khoá, kể cả username khác hoa thường", () =>
    inTx(async (db) => {
      const max = THROTTLE_RULES.user.maxAttempts;
      expect(await fail(db, "chu_a", "10.0.0.1", max)).toEqual(Array(max).fill(true));
      expect(await reserveLoginAttempt(db, { username: "CHU_A", ip: "10.0.0.2" })).toBe(false);
      expect(await reserveLoginAttempt(db, { username: "chu_b", ip: "10.0.0.1" })).toBe(true);
    }));

  it("đăng nhập đúng xoá bộ đếm username, trả lại chỗ cho IP", () =>
    inTx(async (db, c) => {
      await fail(db, "chu_a", "10.0.0.1", THROTTLE_RULES.user.maxAttempts - 1);
      await reserveLoginAttempt(db, { username: "chu_a", ip: "10.0.0.1" });
      await releaseLoginAttempt(db, { username: "chu_a", ip: "10.0.0.1" });
      const { rows } = await c.query(`SELECT scope, attempts FROM login_throttles ORDER BY scope`);
      expect(rows).toEqual([{ scope: "ip", attempts: THROTTLE_RULES.user.maxAttempts - 1 }]);
      expect(await fail(db, "chu_a", "10.0.0.1", THROTTLE_RULES.user.maxAttempts)).not.toContain(false);
    }));

  it("khoá theo IP khi dò nhiều username", () =>
    inTx(async (db) => {
      const max = THROTTLE_RULES.ip.maxAttempts;
      for (let i = 0; i < max; i++) expect(await reserveLoginAttempt(db, { username: `u${i}`, ip: "10.0.0.9" })).toBe(true);
      expect(await reserveLoginAttempt(db, { username: "u_moi", ip: "10.0.0.9" })).toBe(false);
      expect(await reserveLoginAttempt(db, { username: "u_moi", ip: null })).toBe(true);
    }));

  it("hết khoá hoặc hết cửa sổ đếm thì đếm lại từ đầu", () =>
    inTx(async (db, c) => {
      await fail(db, "chu_a", null, THROTTLE_RULES.user.maxAttempts + 1);
      await c.query(`UPDATE login_throttles SET locked_until = now() - interval '1 second'`);
      expect(await reserveLoginAttempt(db, { username: "chu_a", ip: null })).toBe(true);
      await fail(db, "chu_b", null, THROTTLE_RULES.user.maxAttempts - 1);
      await c.query(`UPDATE login_throttles SET window_started_at = now() - interval '1 day' WHERE key = 'chu_b'`);
      const { rows } = await c.query(`SELECT key, attempts, locked_until FROM login_throttles ORDER BY key`);
      expect(rows).toEqual([
        { key: "chu_a", attempts: 1, locked_until: null },
        { key: "chu_b", attempts: THROTTLE_RULES.user.maxAttempts - 1, locked_until: null },
      ]);
      expect(await fail(db, "chu_b", null, THROTTLE_RULES.user.maxAttempts)).not.toContain(false);
    }));
});
