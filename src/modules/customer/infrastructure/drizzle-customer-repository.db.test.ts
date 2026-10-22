// Sửa thông tin khách, xem CCCD đầy đủ trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của repository thành savepoint bên trong.
import { randomBytes } from "node:crypto";
import { TransactionRollbackError, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import type { Actor, CustomerEditDraft } from "../application/ports";
import type { NewCustomer } from "../domain/customer";
import { CccdCipher } from "./cccd-cipher";
import { DrizzleCustomerRepository } from "./drizzle-customer-repository";
import { DrizzleCustomerWriter } from "./drizzle-customer-writer";

const url = process.env.DATABASE_URL;
const cipher = new CccdCipher(randomBytes(32), randomBytes(32));
const BINH: NewCustomer = {
  fullName: "Nguyễn Văn Bình",
  cccd: "001099012345",
  phone: "0912345678",
  address: "12 Lê Lợi",
};

describe.skipIf(!url)("DrizzleCustomerRepository", () => {
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

  const rows = async <T>(db: Db, query: ReturnType<typeof sql>) =>
    (await db.execute(query)).rows as T[];

  let n = 0;
  async function seedShop(db: Db): Promise<Actor> {
    const id = `cu_${Date.now()}_${n++}`;
    const [shop] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO shops (name, opened_at, trial_ends_at) VALUES ('Tiệm Test', '2026-10-01', now() + interval '7 days') RETURNING id`,
    );
    const [user] = await rows<{ id: string }>(
      db,
      sql`INSERT INTO users (shop_id, name, email, username, role) VALUES (${shop.id}, 'Chủ Test', ${`${id}@test.local`}, ${id}, 'owner') RETURNING id`,
    );
    return { shopId: shop.id, userId: user.id };
  }

  const createCustomer = (db: Db, actor: Actor, customer: NewCustomer) =>
    db.transaction(
      async (tx) =>
        (
          await new DrizzleCustomerWriter(() => cipher).resolve(
            tx,
            actor,
            customer,
          )
        ).id,
    );
  const repo = (db: Db) => new DrizzleCustomerRepository(db, () => cipher);

  const edit = (
    customerId: string,
    change: Partial<CustomerEditDraft> = {},
  ): CustomerEditDraft => ({
    customerId,
    expected: {
      fullName: BINH.fullName,
      phone: BINH.phone,
      address: BINH.address,
      cccdMasked: "********2345",
    },
    info: { fullName: BINH.fullName, phone: BINH.phone, address: BINH.address },
    cccd: null,
    ...change,
  });

  const stored = async (db: Db, customerId: string) =>
    (
      await rows<{
        full_name: string;
        phone: string | null;
        address: string | null;
        cccd_masked: string | null;
        cccd_encrypted: string;
      }>(
        db,
        sql`SELECT full_name, phone, address, cccd_masked, cccd_encrypted FROM customers WHERE id = ${customerId}`,
      )
    )[0];

  const audits = (db: Db, customerId: string) =>
    rows<{ action: string; changed_fields: string[] }>(
      db,
      sql`SELECT action, changed_fields FROM audit_logs WHERE entity = 'customer' AND entity_id = ${customerId} AND action <> 'create' ORDER BY at, id`,
    );

  it("sửa tên, SĐT, địa chỉ, CCCD: ghi audit edit kèm tên cột, CCCD mã hoá lại", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const id = await createCustomer(db, actor, BINH);
      const result = await repo(db).recordEdit(
        actor,
        edit(id, {
          info: {
            fullName: "Nguyễn Văn Bình B",
            phone: null,
            address: "34 Lê Lợi",
          },
          cccd: "001099054321",
        }),
      );
      expect(result).toEqual({
        ok: true,
        changed: ["fullName", "phone", "address", "cccd"],
      });
      const row = await stored(db, id);
      expect(row).toMatchObject({
        full_name: "Nguyễn Văn Bình B",
        phone: null,
        address: "34 Lê Lợi",
        cccd_masked: "********4321",
      });
      expect(cipher.decrypt(actor.shopId, row.cccd_encrypted)).toBe(
        "001099054321",
      );
      expect(await audits(db, id)).toEqual([
        {
          action: "edit",
          changed_fields: ["full_name", "phone", "address", "cccd"],
        },
      ]);
    }));

  it("CCCD để trống hoặc nhập lại đúng số cũ: không đổi; không đổi gì thì không ghi audit", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const id = await createCustomer(db, actor, BINH);
      expect(await repo(db).recordEdit(actor, edit(id))).toEqual({
        ok: true,
        changed: [],
      });
      expect(
        await repo(db).recordEdit(actor, edit(id, { cccd: BINH.cccd })),
      ).toEqual({ ok: true, changed: [] });
      expect(await audits(db, id)).toEqual([]);
    }));

  it("giá trị đang thấy đã cũ → stale; CCCD trùng khách khác → duplicate_cccd, không đổi gì", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const id = await createCustomer(db, actor, BINH);
      await createCustomer(db, actor, {
        fullName: "Đặng Thị Hoa",
        cccd: "001099054321",
        phone: null,
        address: null,
      });

      const old = edit(id, {
        expected: {
          fullName: "Tên cũ",
          phone: BINH.phone,
          address: BINH.address,
          cccdMasked: "********2345",
        },
      });
      expect(await repo(db).recordEdit(actor, old)).toEqual({
        ok: false,
        error: "stale",
      });
      const dup = edit(id, {
        info: {
          fullName: "Bình mới",
          phone: BINH.phone,
          address: BINH.address,
        },
        cccd: "001099054321",
      });
      expect(await repo(db).recordEdit(actor, dup)).toEqual({
        ok: false,
        error: "duplicate_cccd",
      });
      expect(await stored(db, id)).toMatchObject({
        full_name: BINH.fullName,
        cccd_masked: "********2345",
      });
      expect(await audits(db, id)).toEqual([]);
    }));

  it("xem CCCD đầy đủ: giải mã, mỗi lần xem ghi audit view_cccd; khách chưa có CCCD thì không ghi", () =>
    inTx(async (db) => {
      const actor = await seedShop(db);
      const id = await createCustomer(db, actor, BINH);
      const noCccd = await createCustomer(db, actor, {
        fullName: "Khách",
        cccd: null,
        phone: null,
        address: null,
      });
      expect(await repo(db).revealCccd(actor, id)).toEqual({
        cccd: "001099012345",
      });
      expect(await repo(db).revealCccd(actor, noCccd)).toEqual({ cccd: null });
      expect(await audits(db, id)).toEqual([
        { action: "view_cccd", changed_fields: [] },
      ]);
      expect(await audits(db, noCccd)).toEqual([]);
    }));

  it("cách ly cửa hàng: B không sửa, không xem được khách của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      const id = await createCustomer(db, a, BINH);
      const b = await seedShop(db);
      expect(
        await repo(db).recordEdit(
          b,
          edit(id, { info: { fullName: "Đổi", phone: null, address: null } }),
        ),
      ).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await repo(db).revealCccd(b, id)).toBeNull();
      expect(await stored(db, id)).toMatchObject({ full_name: BINH.fullName });
      expect(await audits(db, id)).toEqual([]);
    }));
});
