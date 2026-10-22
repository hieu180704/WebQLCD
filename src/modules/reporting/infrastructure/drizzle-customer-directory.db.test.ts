// Danh sách khách hàng trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import type { CustomerQuery } from "../application/list-customers";
import { inRollbackTx, seedCash, seedContract, seedCustomer, seedShop } from "./db-test-kit";
import { DrizzleCustomerDirectory } from "./drizzle-customer-directory";

const url = process.env.DATABASE_URL;
const TODAY = "2026-10-22";
const hash = (shopId: string, cccd: string) => `h:${shopId}:${cccd}`;
const ALL: CustomerQuery = { search: null, cccd: null, filter: null };

describe.skipIf(!url)("DrizzleCustomerDirectory", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const inTx = (fn: (db: Db) => Promise<void>) => inRollbackTx(pool, fn);
  const directory = (db: Db) => new DrizzleCustomerDirectory(db, hash);
  const names = async (db: Db, shopId: string, query: Partial<CustomerQuery>) =>
    (await directory(db).list(shopId, { ...ALL, ...query }, TODAY, null, 50)).map((c) => c.fullName);

  it("số liệu mỗi khách: HĐ mở, quá hạn, dư nợ chỉ tính hợp đồng đang mở chưa xoá; giao dịch gần nhất; SĐT che; tổng", () =>
    inTx(async (db) => {
      const shop = await seedShop(db); // kèm khách "Khách" chưa có hợp đồng
      const binh = await seedCustomer(db, shop.shopId, { fullName: "Nguyễn Văn Bình", phone: "0912345678", address: "12 Lê Lợi" });
      const overdue = await seedContract(db, shop, { customerId: binh, outstanding: 5_000_000, paidUntil: "2026-10-01" }); // hạn 11/10
      await seedContract(db, shop, { customerId: binh, outstanding: 3_000_000, paidUntil: "2026-10-20" }); // hạn 30/10
      await seedContract(db, shop, { customerId: binh, outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await seedContract(db, shop, { customerId: binh, outstanding: 9_000_000, paidUntil: "2026-09-01", deleted: true });
      await seedCash(db, shop, { date: "2026-10-05", type: "interest_payment", amount: 100_000, contractId: overdue });
      await seedCash(db, shop, { date: "2026-09-30", type: "interest_payment", amount: 100_000, contractId: overdue });

      const [first, second] = await directory(db).list(shop.shopId, ALL, TODAY, null, 50);
      expect(first).toMatchObject({
        fullName: "Nguyễn Văn Bình",
        phone: "091****678",
        address: "12 Lê Lợi",
        cccdMasked: null,
        openContracts: 2,
        overdueContracts: 1,
        lastActivity: "2026-10-05",
      });
      expect(first.debt.toBigInt()).toBe(8_000_000n);
      expect(second).toMatchObject({ fullName: "Khách", openContracts: 0, overdueContracts: 0, lastActivity: null });
      expect(second.debt.isZero()).toBe(true);
      expect(await directory(db).totals(shop.shopId)).toEqual({ customers: 2, withOpenContracts: 1 });
    }));

  it("tìm tên không dấu / không phân biệt hoa thường, tìm SĐT, ký tự LIKE theo nghĩa đen, CCCD khớp hash", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      await seedCustomer(db, shop.shopId, { fullName: "Nguyễn Văn Bình", phone: "0912345678" });
      await seedCustomer(db, shop.shopId, { fullName: "ĐẶNG THỊ HOA", phone: "0987000111", cccdHash: hash(shop.shopId, "001099012345") });
      await seedCustomer(db, shop.shopId, { fullName: "Lê 100% Vàng" });

      expect(await names(db, shop.shopId, { search: "binh" })).toEqual(["Nguyễn Văn Bình"]);
      expect(await names(db, shop.shopId, { search: "dang thi" })).toEqual(["ĐẶNG THỊ HOA"]);
      expect(await names(db, shop.shopId, { search: "Đặng" })).toEqual(["ĐẶNG THỊ HOA"]);
      expect(await names(db, shop.shopId, { search: "345 678" })).toEqual(["Nguyễn Văn Bình"]);
      expect(await names(db, shop.shopId, { search: "%" })).toEqual(["Lê 100% Vàng"]);
      expect(await names(db, shop.shopId, { search: "_" })).toEqual([]);
      expect(await names(db, shop.shopId, { cccd: "001099012345" })).toEqual(["ĐẶNG THỊ HOA"]);
      expect(await names(db, shop.shopId, { cccd: "001099099999" })).toEqual([]);
    }));

  it("lọc đang có HĐ mở / có HĐ quá hạn; phân trang keyset mới nhất trước", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const a = await seedCustomer(db, shop.shopId, { fullName: "A" });
      const b = await seedCustomer(db, shop.shopId, { fullName: "B" });
      await seedContract(db, shop, { customerId: a, outstanding: 1_000_000, paidUntil: "2026-10-01" }); // quá hạn
      await seedContract(db, shop, { customerId: b, outstanding: 1_000_000, paidUntil: "2026-10-20" }); // chưa tới hạn

      expect(await names(db, shop.shopId, { filter: "open" })).toEqual(["B", "A"]);
      expect(await names(db, shop.shopId, { filter: "overdue" })).toEqual(["A"]);
      const page1 = await directory(db).list(shop.shopId, ALL, TODAY, null, 2);
      expect(page1.map((c) => c.fullName)).toEqual(["B", "A"]);
      const page2 = await directory(db).list(shop.shopId, ALL, TODAY, page1[1].id, 2);
      expect(page2.map((c) => c.fullName)).toEqual(["Khách"]);
    }));

  it("cách ly cửa hàng: B không thấy khách, không khớp CCCD, không đếm khách của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      await seedCustomer(db, a.shopId, { fullName: "Nguyễn Văn Bình", cccdHash: hash(a.shopId, "001099012345") });
      await seedContract(db, a, { outstanding: 1_000_000, paidUntil: "2026-10-01" });
      const b = await seedShop(db);
      expect(await names(db, b.shopId, {})).toEqual(["Khách"]);
      expect(await names(db, b.shopId, { search: "binh" })).toEqual([]);
      expect(await names(db, b.shopId, { cccd: "001099012345" })).toEqual([]);
      expect(await directory(db).totals(b.shopId)).toEqual({ customers: 1, withOpenContracts: 0 });
    }));
});
