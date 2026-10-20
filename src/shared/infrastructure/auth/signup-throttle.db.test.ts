// Giới hạn đăng ký trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi ROLLBACK.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIGNUP_RULE, reserveSignupAttempt } from "./signup-throttle";

type Db = NodePgDatabase<Record<string, unknown>>;

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("giới hạn đăng ký", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
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

  const reserve = async (db: Db, ip: string, times: number) => {
    const results: boolean[] = [];
    for (let i = 0; i < times; i++) results.push(await reserveSignupAttempt(db, ip));
    return results;
  };

  it("hết lượt trong cửa sổ thì bị chặn, IP khác không ảnh hưởng", () =>
    inTx(async (db) => {
      const results = await reserve(db, "10.0.0.1", SIGNUP_RULE.maxAttempts + 1);
      expect(results.slice(0, SIGNUP_RULE.maxAttempts).every(Boolean)).toBe(true);
      expect(results.at(-1)).toBe(false);
      expect(await reserveSignupAttempt(db, "10.0.0.2")).toBe(true);
    }));

  it("qua cửa sổ thì đếm lại từ 1", () =>
    inTx(async (db, c) => {
      await reserve(db, "10.0.0.3", SIGNUP_RULE.maxAttempts + 1);
      await c.query(
        `UPDATE login_throttles SET window_started_at = now() - make_interval(secs => $1)
         WHERE scope = 'signup' AND key = '10.0.0.3'`,
        [SIGNUP_RULE.windowSeconds + 1],
      );
      expect(await reserveSignupAttempt(db, "10.0.0.3")).toBe(true);
      const { rows } = await c.query(`SELECT attempts FROM login_throttles WHERE scope = 'signup' AND key = '10.0.0.3'`);
      expect(rows[0].attempts).toBe(1);
    }));
});
