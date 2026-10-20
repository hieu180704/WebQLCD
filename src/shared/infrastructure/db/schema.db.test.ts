// Kiểm ràng buộc DB trên PostgreSQL thật (cần DATABASE_URL, đã chạy `npm run db:migrate`).
// Mỗi test chạy trong một transaction rồi ROLLBACK, không để lại dữ liệu.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("ràng buộc DB", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inTx(fn: (c: PoolClient) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await fn(c);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }

  // Lỗi mong đợi làm hỏng transaction, nên bọc trong savepoint để chạy tiếp được.
  async function expectPgError(c: PoolClient, code: string, text: string, params: unknown[] = []) {
    await c.query("SAVEPOINT s");
    await expect(c.query(text, params)).rejects.toMatchObject({ code });
    await c.query("ROLLBACK TO SAVEPOINT s");
  }

  async function seed(c: PoolClient) {
    const one = async (text: string, params: unknown[]) => (await c.query(text, params)).rows[0].id as string;
    const shop = (name: string) =>
      one(`INSERT INTO shops (name, opened_at, trial_ends_at) VALUES ($1, '2026-10-20', now() + interval '7 days') RETURNING id`, [name]);
    const shopA = await shop("Tiệm A");
    const shopB = await shop("Tiệm B");
    const user = (shopId: string, username: string) =>
      one(
        `INSERT INTO users (shop_id, name, email, username, role) VALUES ($1, $2, $3, $2, 'owner') RETURNING id`,
        [shopId, username, `${username}@test.local`],
      );
    const userA = await user(shopA, "chu_a");
    await user(shopB, "chu_b");
    const customer = (shopId: string) =>
      one(`INSERT INTO customers (shop_id, full_name) VALUES ($1, 'Nguyễn Văn A') RETURNING id`, [shopId]);
    const customerA = await customer(shopA);
    const customerB = await customer(shopB);
    const contractA = await one(
      `INSERT INTO contracts (shop_id, code, customer_id, kind, asset_name, principal, outstanding_principal,
         interest_type, interest_rate, interest_period_days, term_days, loan_date, interest_paid_until, staff_id)
       VALUES ($1, 'CD-1', $2, 'secured', 'Xe máy', 5000000, 5000000, 'per_million_per_day', 3, 10, 30,
         '2026-10-20', '2026-10-20', $3) RETURNING id`,
      [shopA, customerA, userA],
    );
    const disbursement = await one(
      `INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, created_by)
       VALUES ($1, uuidv7(), '2026-10-20', -5000000, 'disbursement', $2, $3) RETURNING id`,
      [shopA, contractA, userA],
    );
    return { shopA, shopB, userA, customerA, customerB, contractA, disbursement };
  }

  const reversal = `INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, reverses_id, created_by)
    VALUES ($1, uuidv7(), '2026-10-20', $2, 'reversal', $3, $4, $5) RETURNING id`;

  it("sổ két chặn UPDATE, DELETE, TRUNCATE", () =>
    inTx(async (c) => {
      const s = await seed(c);
      await expectPgError(c, "23001", `UPDATE cash_transactions SET amount = -1 WHERE id = $1`, [s.disbursement]);
      await expectPgError(c, "23001", `DELETE FROM cash_transactions WHERE id = $1`, [s.disbursement]);
      await expectPgError(c, "23001", `TRUNCATE cash_transactions CASCADE`);
    }));

  it("audit_logs chặn UPDATE, DELETE", () =>
    inTx(async (c) => {
      const s = await seed(c);
      const { rows } = await c.query(
        `INSERT INTO audit_logs (shop_id, user_id, entity, entity_id, action, changed_fields)
         VALUES ($1, $2, 'contract', $3, 'edit', '{note}') RETURNING id`,
        [s.shopA, s.userA, s.contractA],
      );
      await expectPgError(c, "23001", `UPDATE audit_logs SET action = 'x' WHERE id = $1`, [rows[0].id]);
      await expectPgError(c, "23001", `DELETE FROM audit_logs WHERE id = $1`, [rows[0].id]);
    }));

  it("khoá ngoại kép chặn tham chiếu chéo cửa hàng", () =>
    inTx(async (c) => {
      const s = await seed(c);
      await expectPgError(
        c,
        "23503",
        `INSERT INTO contracts (shop_id, code, customer_id, kind, principal, outstanding_principal, interest_type,
           interest_rate, interest_period_days, term_days, loan_date, interest_paid_until, staff_id)
         VALUES ($1, 'TC-1', $2, 'unsecured', 1000000, 1000000, 'percent_per_month', 3, 30, 30, '2026-10-20', '2026-10-20', $3)`,
        [s.shopA, s.customerB, s.userA],
      );
      await expectPgError(
        c,
        "23503",
        `INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, created_by)
         VALUES ($1, uuidv7(), '2026-10-20', 100000, 'principal_repayment', $2, $3)`,
        [s.shopB, s.contractA, s.userA],
      );
    }));

  it("CHECK nghiệp vụ: cầm đồ cần tên tài sản, dấu tiền theo type, kỳ lãi", () =>
    inTx(async (c) => {
      const s = await seed(c);
      await expectPgError(
        c,
        "23514",
        `INSERT INTO contracts (shop_id, code, customer_id, kind, asset_name, principal, outstanding_principal, interest_type,
           interest_rate, interest_period_days, term_days, loan_date, interest_paid_until, staff_id)
         VALUES ($1, 'CD-2', $2, 'secured', '  ', 1000000, 1000000, 'percent_per_month', 3, 30, 30, '2026-10-20', '2026-10-20', $3)`,
        [s.shopA, s.customerA, s.userA],
      );
      const tx = (amount: number, type: string, extra = "") =>
        `INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, created_by${extra ? ", period_from, period_to" : ""})
         VALUES ($1, uuidv7(), '2026-10-20', ${amount}, '${type}', $2, $3${extra})`;
      await expectPgError(c, "23514", tx(5000000, "disbursement"), [s.shopA, s.contractA, s.userA]);
      await expectPgError(c, "23514", tx(150000, "interest_payment"), [s.shopA, s.contractA, s.userA]);
      await c.query(tx(150000, "interest_payment", ", '2026-10-20', '2026-10-30'"), [s.shopA, s.contractA, s.userA]);
    }));

  it("reversal: hợp lệ một lần; chặn đảo lần hai, sai số tiền, đảo bút toán đảo", () =>
    inTx(async (c) => {
      const s = await seed(c);
      await expectPgError(c, "23514", reversal, [s.shopA, -5000000, s.contractA, s.disbursement, s.userA]);
      const { rows } = await c.query(reversal, [s.shopA, 5000000, s.contractA, s.disbursement, s.userA]);
      await expectPgError(c, "23505", reversal, [s.shopA, 5000000, s.contractA, s.disbursement, s.userA]);
      await expectPgError(c, "23514", reversal, [s.shopA, -5000000, s.contractA, rows[0].id, s.userA]);
      const sum = await c.query(`SELECT sum(amount)::text AS total FROM cash_transactions WHERE shop_id = $1`, [s.shopA]);
      expect(sum.rows[0].total).toBe("0");
    }));

  it("username không trùng bất kể hoa thường", () =>
    inTx(async (c) => {
      const s = await seed(c);
      await expectPgError(
        c,
        "23505",
        `INSERT INTO users (shop_id, name, email, username, role) VALUES ($1, 'x', 'x@test.local', 'CHU_A', 'staff')`,
        [s.shopB],
      );
    }));

  it("Drizzle: uuid v7, bigint vượt 2^53, date dạng chuỗi", () =>
    inTx(async (c) => {
      const s = await seed(c);
      const db = drizzle({ client: c, schema });
      const big = 9_007_199_254_740_993n;
      await db.update(schema.contracts).set({ principal: big }).where(eq(schema.contracts.id, s.contractA));
      const [row] = await db
        .select({ id: schema.contracts.id, principal: schema.contracts.principal, loanDate: schema.contracts.loanDate })
        .from(schema.contracts)
        .where(eq(schema.contracts.id, s.contractA));
      expect(row.principal).toBe(big);
      expect(row.loanDate).toBe("2026-10-20");
      expect(row.id[14]).toBe("7");
    }));
});
