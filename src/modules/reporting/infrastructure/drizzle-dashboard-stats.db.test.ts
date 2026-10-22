// Thống kê trang chủ trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { TransactionRollbackError, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import { DrizzleDashboardStats } from "./drizzle-dashboard-stats";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-22";
const MONTH = { from: "2026-10-01", to: "2026-11-01" };

describe.skipIf(!url)("DrizzleDashboardStats", () => {
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

  const rows = async <T>(db: Db, query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];

  let n = 0;
  async function seedShop(db: Db) {
    const id = `ds_${Date.now()}_${n++}`;
    const [shop] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO shops (name, opened_at, trial_ends_at) VALUES ('Tiệm Test', ${TODAY}, now() + interval '7 days') RETURNING id`,
    );
    const [user] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO users (shop_id, name, email, username, role) VALUES (${shop.id}, 'Chủ Test', ${`${id}@test.local`}, ${id}, 'owner') RETURNING id`,
    );
    const [customer] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO customers (shop_id, full_name) VALUES (${shop.id}, 'Khách') RETURNING id`,
    );
    return { shopId: shop.id, userId: user.id, customerId: customer.id };
  }
  type Shop = Awaited<ReturnType<typeof seedShop>>;

  let code = 0;
  async function seedContract(
    db: Db,
    shop: Shop,
    c: {
      kind?: "secured" | "unsecured";
      outstanding: number;
      paidUntil: string;
      period?: number;
      prepaid?: boolean;
      rate?: string;
      closed?: boolean;
      deleted?: boolean;
    },
  ) {
    const [row] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO contracts (shop_id, code, customer_id, kind, asset_name, principal, outstanding_principal, interest_type,
            interest_rate, interest_period_days, term_days, loan_date, interest_paid_until, prepaid_interest, status, closed_at, staff_id,
            deleted_at, deleted_by, deleted_reason)
          VALUES (${shop.shopId}, ${`CD-${++code}`}, ${shop.customerId}, ${c.kind ?? "secured"}, 'Xe', 10000000, ${c.outstanding},
            'percent_per_month', ${c.rate ?? "3"}, ${c.period ?? 10}, 90, '2026-09-01', ${c.paidUntil}, ${c.prepaid ?? false},
            ${c.closed ? "closed" : "active"}, ${c.closed ? sql`now()` : null}, ${shop.userId},
            ${c.deleted ? sql`now()` : null}, ${c.deleted ? shop.userId : null}, ${c.deleted ? "Nhập sai" : null})
          RETURNING id`,
    );
    return row.id;
  }

  async function cash(db: Db, shop: Shop, c: { date: string; type: string; amount: number; contractId?: string; reverses?: string }) {
    const period = c.type === "interest_payment" ? ["2026-09-01", "2026-09-11"] : [null, null];
    const [row] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO cash_transactions (shop_id, operation_id, business_date, amount, type, contract_id, period_from, period_to, reverses_id, created_by)
          VALUES (${shop.shopId}, ${crypto.randomUUID()}, ${c.date}, ${c.amount}, ${c.type}, ${c.contractId ?? null}, ${period[0]}, ${period[1]},
            ${c.reverses ?? null}, ${shop.userId})
          RETURNING id`,
    );
    return row.id;
  }

  const load = (db: Db, shopId: string) => new DrizzleDashboardStats(db).load(shopId, TODAY, MONTH);

  it("đang cho vay, đếm theo loại, quá hạn: chỉ hợp đồng đang mở chưa xoá; hạn theo thu lãi trước/sau; bỏ lãi suất 0", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedContract(db, shop, { outstanding: 5_000_000, paidUntil: "2026-10-11" }); // hạn 21/10: quá hạn
      await seedContract(db, shop, { outstanding: 3_000_000, paidUntil: "2026-10-12" }); // hạn 22/10: hôm nay, chưa quá
      await seedContract(db, shop, { kind: "unsecured", outstanding: 2_000_000, paidUntil: "2026-10-21", prepaid: true }); // hạn 21/10: quá hạn
      await seedContract(db, shop, { kind: "unsecured", outstanding: 1_000_000, paidUntil: "2026-09-01", rate: "0" }); // lãi suất 0
      await seedContract(db, shop, { outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await seedContract(db, shop, { outstanding: 7_000_000, paidUntil: "2026-09-01", deleted: true });

      const stats = await load(db, shop.shopId);
      expect(stats).toMatchObject({ openSecured: 2, openUnsecured: 2, overdue: 2 });
      expect(stats.lending.toBigInt()).toBe(11_000_000n);
    }));

  it("lãi tháng này: dòng lãi + dòng đảo lãi ghi trong tháng; bỏ tháng khác, loại khác, đảo của dòng không phải lãi", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const id = await seedContract(db, shop, { outstanding: 5_000_000, paidUntil: "2026-10-11" });
      await cash(db, shop, { date: "2026-10-01", type: "interest_payment", amount: 100_000, contractId: id });
      const reversedInMonth = await cash(db, shop, { date: "2026-10-05", type: "interest_payment", amount: 40_000, contractId: id });
      await cash(db, shop, { date: "2026-10-06", type: "reversal", amount: -40_000, contractId: id, reverses: reversedInMonth });
      const lastMonth = await cash(db, shop, { date: "2026-09-30", type: "interest_payment", amount: 30_000, contractId: id });
      await cash(db, shop, { date: "2026-10-02", type: "reversal", amount: -30_000, contractId: id, reverses: lastMonth });
      await cash(db, shop, { date: "2026-11-01", type: "interest_payment", amount: 9_000, contractId: id });
      const repaid = await cash(db, shop, { date: "2026-10-03", type: "principal_repayment", amount: 500_000, contractId: id });
      await cash(db, shop, { date: "2026-10-04", type: "reversal", amount: -500_000, contractId: id, reverses: repaid });
      await cash(db, shop, { date: "2026-10-03", type: "manual_income", amount: 70_000 });

      // 100k + 40k − 40k − 30k (đảo trong tháng của dòng lãi tháng trước).
      expect((await load(db, shop.shopId)).interestThisMonth.toBigInt()).toBe(70_000n);
    }));

  it("cách ly cửa hàng: B không thấy số liệu của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const id = await seedContract(db, a, { outstanding: 5_000_000, paidUntil: "2026-10-01" });
      await cash(db, a, { date: TODAY, type: "interest_payment", amount: 100_000, contractId: id });
      const b = await seedShop(db);
      const stats = await load(db, b.shopId);
      expect(stats).toMatchObject({ openSecured: 0, openUnsecured: 0, overdue: 0 });
      expect(stats.lending.isZero()).toBe(true);
      expect(stats.interestThisMonth.isZero()).toBe(true);
    }));
});
