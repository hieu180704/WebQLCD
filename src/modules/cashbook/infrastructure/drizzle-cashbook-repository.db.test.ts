// Sổ két trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của repository thành savepoint bên trong.
import { TransactionRollbackError, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db, Tx } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import { Money } from "@/shared/kernel/money";
import type { Actor } from "../application/ports";
import { appendCashEntries } from "./cash-ledger";
import { DrizzleCashbookRepository } from "./drizzle-cashbook-repository";

const url = process.env.DATABASE_URL;
const OPENED = "2026-10-18";
const vnd = (n: number) => Money.fromNumber(n);

describe.skipIf(!url)("DrizzleCashbookRepository", () => {
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

  const one = async (db: Db, query: ReturnType<typeof sql>) => (await db.execute(query)).rows[0] as Record<string, string>;

  let n = 0;
  async function seedShop(db: Db): Promise<Actor & { contractId: string }> {
    const id = `cb_${Date.now()}_${n++}`;
    const shop = await one(db, sql`INSERT INTO shops (name, opened_at, trial_ends_at) VALUES ('Tiệm Test', ${OPENED}, now() + interval '7 days') RETURNING id`);
    const user = await one(
      db,
      sql`INSERT INTO users (shop_id, name, email, username, role) VALUES (${shop.id}, 'Chủ Test', ${`${id}@test.local`}, ${id}, 'owner') RETURNING id`,
    );
    const customer = await one(db, sql`INSERT INTO customers (shop_id, full_name) VALUES (${shop.id}, 'Khách') RETURNING id`);
    const contract = await one(
      db,
      sql`INSERT INTO contracts (shop_id, code, customer_id, kind, asset_name, principal, outstanding_principal,
            interest_type, interest_rate, interest_period_days, term_days, loan_date, interest_paid_until, staff_id)
          VALUES (${shop.id}, 'CD-1', ${customer.id}, 'secured', 'Xe', 5000000, 5000000, 'per_million_per_day', 3, 10, 30,
            '2026-10-20', '2026-10-20', ${user.id}) RETURNING id`,
    );
    return { shopId: shop.id, userId: user.id, contractId: contract.id };
  }

  const disburse = (db: Db, s: Actor & { contractId: string }, date: string, amount: number) =>
    appendCashEntries(db as unknown as Tx, { shopId: s.shopId, createdBy: s.userId, businessDate: date }, [
      { type: "disbursement", contractId: s.contractId, amount: vnd(amount) },
      { type: "interest_payment", contractId: s.contractId, amount: vnd(amount / 100), periodFrom: date, periodTo: date },
    ]);

  it("quỹ đầu két: ghi vào ngày mở két, chỉ một lần", () =>
    inTx(async (db) => {
      const s = await seedShop(db);
      const repo = new DrizzleCashbookRepository(db);
      expect(await repo.hasOpeningBalance(s.shopId)).toBe(false);
      expect(await repo.recordOpeningBalance(s, vnd(20_000_000))).toBe("ok");
      expect(await repo.recordOpeningBalance(s, vnd(1_000))).toBe("already_set");
      expect(await repo.hasOpeningBalance(s.shopId)).toBe(true);
      const row = await one(db, sql`SELECT business_date::text AS d, amount::text AS a, created_by AS u FROM cash_transactions WHERE shop_id = ${s.shopId}`);
      expect(row).toEqual({ d: OPENED, a: "20000000", u: s.userId });
    }));

  it("tổng ngày: đầu ngày = mọi giao dịch trước ngày; cuối ngày = đầu − chi + thu", () =>
    inTx(async (db) => {
      const s = await seedShop(db);
      const repo = new DrizzleCashbookRepository(db);
      await repo.recordOpeningBalance(s, vnd(20_000_000));
      await disburse(db, s, "2026-10-19", 1_000_000); // −1.000.000, +10.000
      await disburse(db, s, "2026-10-20", 5_000_000); // −5.000.000, +50.000

      const t = await repo.dayTotals(s.shopId, "2026-10-20");
      expect([t.opening, t.income, t.expense].map((m) => m.toBigInt())).toEqual([19_010_000n, 50_000n, -5_000_000n]);
      // Ngày mở két: quỹ đầu két nằm ở "đầu ngày", không lẫn vào "thu".
      const opened = await repo.dayTotals(s.shopId, OPENED);
      expect([opened.opening, opened.income].map((m) => m.toBigInt())).toEqual([20_000_000n, 0n]);
      const before = await repo.dayTotals(s.shopId, "2026-10-17");
      expect([before.opening, before.income, before.expense].every((m) => m.isZero())).toBe(true);
    }));

  it("cách ly cửa hàng và phân trang keyset danh sách trong ngày", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const b = await seedShop(db);
      const repo = new DrizzleCashbookRepository(db);
      await disburse(db, a, "2026-10-20", 1_000_000);
      await disburse(db, a, "2026-10-20", 2_000_000);

      expect((await repo.dayTotals(b.shopId, "2026-10-20")).expense.isZero()).toBe(true);
      expect(await repo.listDay(b.shopId, "2026-10-20", null, 10)).toEqual([]);
      expect(await repo.recordOpeningBalance(b, vnd(5_000))).toBe("ok"); // A chưa nhập, B nhập độc lập.

      const page1 = await repo.listDay(a.shopId, "2026-10-20", null, 3);
      expect(page1.map((l) => l.amount.toBigInt())).toEqual([20_000n, -2_000_000n, 10_000n]);
      expect(page1[0]).toMatchObject({ type: "interest_payment", contractCode: "CD-1", createdByName: "Chủ Test" });
      const page2 = await repo.listDay(a.shopId, "2026-10-20", page1[2].id, 3);
      expect(page2.map((l) => l.type)).toEqual(["disbursement"]);
    }));
});
