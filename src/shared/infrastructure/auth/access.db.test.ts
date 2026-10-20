// Guard: luật quyền (unit) và quyền ghi theo thuê bao tính trên PostgreSQL thật.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessDeniedError, checkAccess, loadAccess, type AccessRow } from "./access";

describe("checkAccess", () => {
  const owner: AccessRow = { userId: "u", shopId: "s", role: "owner", isActive: true, canWrite: true };
  const denied = (row: AccessRow, options: Parameters<typeof checkAccess>[1]) => {
    try {
      checkAccess(row, options);
    } catch (error) {
      return error instanceof AccessDeniedError ? error.reason : error;
    }
    return null;
  };

  it("trả đúng principal, không lộ cờ nội bộ", () => {
    expect(checkAccess(owner, { role: "owner", write: true })).toEqual({ userId: "u", shopId: "s", role: "owner" });
  });

  it("chặn tài khoản vô hiệu hoá, sai vai trò, ghi khi chỉ đọc", () => {
    expect(denied({ ...owner, isActive: false }, {})).toBe("inactive");
    expect(denied({ ...owner, role: "staff" }, { role: "owner" })).toBe("role");
    expect(denied({ ...owner, canWrite: false }, { write: true })).toBe("read_only");
    expect(denied({ ...owner, canWrite: false }, {})).toBeNull();
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("loadAccess", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("quyền ghi theo dùng thử, trả phí, hết hạn", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const db = drizzle({ client: c });
      let n = 0;
      const user = async (status: string, trialEndsAt: string, paidUntil: string | null) => {
        const shop = await c.query(
          `INSERT INTO shops (name, opened_at, subscription_status, trial_ends_at, paid_until)
           VALUES ('Tiệm', '2026-10-20', $1, now() + $2::interval, now() + $3::interval) RETURNING id`,
          [status, trialEndsAt, paidUntil],
        );
        const name = `access_${n++}`;
        const { rows } = await c.query(
          `INSERT INTO users (shop_id, name, email, username, role) VALUES ($1, $2, $2 || '@test.local', $2, 'staff') RETURNING id`,
          [shop.rows[0].id, name],
        );
        return (await loadAccess(db, rows[0].id))?.canWrite;
      };
      expect(await user("trial", "1 day", null)).toBe(true);
      expect(await user("trial", "-1 day", null)).toBe(false);
      expect(await user("active", "-30 days", "1 day")).toBe(true);
      expect(await user("active", "-30 days", "-1 day")).toBe(false);
      expect(await user("active", "-30 days", null)).toBe(false);
      expect(await user("expired", "1 day", "1 day")).toBe(false);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
