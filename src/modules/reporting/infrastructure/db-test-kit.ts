// Chỉ dùng trong DB test của reporting: transaction rollback + seed dữ liệu bằng SQL thẳng
// (test không import nội bộ module khác). Không import ở code chạy thật.
import { TransactionRollbackError, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";

/** Chạy `fn` trong một transaction rồi rollback. */
export async function inRollbackTx(pool: Pool, fn: (db: Db) => Promise<void>) {
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

export type SeededShop = { shopId: string; userId: string; customerId: string };

/** Cửa hàng + chủ tiệm + một khách mặc định tên "Khách". */
export async function seedShop(db: Db): Promise<SeededShop> {
  const id = `rp_${Date.now()}_${n++}`;
  const [shop] = await rows<{ id: string }>(
    db,
    sql`INSERT INTO shops (name, opened_at, trial_ends_at) VALUES ('Tiệm Test', '2026-10-01', now() + interval '7 days') RETURNING id`,
  );
  const [user] = await rows<{ id: string }>(
    db,
    sql`INSERT INTO users (shop_id, name, email, username, role) VALUES (${shop.id}, 'Chủ Test', ${`${id}@test.local`}, ${id}, 'owner') RETURNING id`,
  );
  const customerId = await seedCustomer(db, shop.id, { fullName: "Khách" });
  return { shopId: shop.id, userId: user.id, customerId };
}

/** `cccdHash` ghi thẳng (test không cần khoá thật); hai cột CCCD còn lại điền giả cho đủ CHECK. */
export async function seedCustomer(
  db: Db,
  shopId: string,
  c: { fullName: string; phone?: string; address?: string; cccdHash?: string; cccdMasked?: string },
): Promise<string> {
  const hasCccd = c.cccdHash !== undefined;
  const [row] = await rows<{ id: string }>(
    db,
    sql`INSERT INTO customers (shop_id, full_name, phone, address, cccd_encrypted, cccd_hash, cccd_masked)
        VALUES (${shopId}, ${c.fullName}, ${c.phone ?? null}, ${c.address ?? null}, ${hasCccd ? "v1:test" : null},
          ${c.cccdHash ?? null}, ${hasCccd ? (c.cccdMasked ?? "********0000") : null})
        RETURNING id`,
  );
  return row.id;
}

let code = 0;

export async function seedContract(
  db: Db,
  shop: SeededShop,
  c: {
    customerId?: string;
    kind?: "secured" | "unsecured";
    outstanding: number;
    paidUntil: string;
    period?: number;
    prepaid?: boolean;
    rate?: string;
    closed?: boolean;
    deleted?: boolean;
  },
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    db,
    sql`INSERT INTO contracts (shop_id, code, customer_id, kind, asset_name, principal, outstanding_principal, interest_type,
          interest_rate, interest_period_days, term_days, loan_date, interest_paid_until, prepaid_interest, status, closed_at, staff_id,
          deleted_at, deleted_by, deleted_reason)
        VALUES (${shop.shopId}, ${`CD-${++code}`}, ${c.customerId ?? shop.customerId}, ${c.kind ?? "secured"}, 'Xe', 10000000, ${c.outstanding},
          'percent_per_month', ${c.rate ?? "3"}, ${c.period ?? 10}, 90, '2026-09-01', ${c.paidUntil}, ${c.prepaid ?? false},
          ${c.closed ? "closed" : "active"}, ${c.closed ? sql`now()` : null}, ${shop.userId},
          ${c.deleted ? sql`now()` : null}, ${c.deleted ? shop.userId : null}, ${c.deleted ? "Nhập sai" : null})
        RETURNING id`,
  );
  return row.id;
}

export async function seedCash(
  db: Db,
  shop: SeededShop,
  c: { date: string; type: string; amount: number; contractId?: string; reverses?: string },
): Promise<string> {
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
