// Danh sách khách hàng trên PostgreSQL thật (cần DATABASE_URL, đã migrate). Mỗi test chạy trong transaction rồi rollback.
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/shared/infrastructure/db/client";
import type { CustomerQuery } from "../application/list-customers";
import { inRollbackTx, seedCash, seedContract, seedCustomer, seedInstallment, seedShop } from "./db-test-kit";
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

  it("số liệu mỗi khách: HĐ mở, quá hạn, dư nợ chỉ tính hợp đồng đang mở chưa xoá (cả trả góp); giao dịch gần nhất; SĐT che; tổng", () =>
    inTx(async (db) => {
      const shop = await seedShop(db); // kèm khách "Khách" chưa có hợp đồng
      const binh = await seedCustomer(db, shop.shopId, { fullName: "Nguyễn Văn Bình", phone: "0912345678", address: "12 Lê Lợi" });
      const overdue = await seedContract(db, shop, { customerId: binh, outstanding: 5_000_000, paidUntil: "2026-10-01" }); // hạn 11/10
      await seedContract(db, shop, { customerId: binh, outstanding: 3_000_000, paidUntil: "2026-10-20" }); // hạn 30/10
      await seedContract(db, shop, { customerId: binh, outstanding: 0, paidUntil: "2026-09-01", closed: true });
      await seedContract(db, shop, { customerId: binh, outstanding: 9_000_000, paidUntil: "2026-09-01", deleted: true });
      await seedCash(db, shop, { date: "2026-10-05", type: "interest_payment", amount: 100_000, contractId: overdue });
      await seedCash(db, shop, { date: "2026-09-30", type: "interest_payment", amount: 100_000, contractId: overdue });
      // Trả góp: chậm góp (bắt đầu 10/10, chưa góp), đúng hạn (góp 400.000), đã đóng, đã xoá; lần góp 06/10 mới hơn dòng lãi.
      await seedInstallment(db, shop, { customerId: binh, startDate: "2026-10-10" });
      const onTime = await seedInstallment(db, shop, { customerId: binh, startDate: "2026-10-20", paid: 400_000 });
      await seedInstallment(db, shop, { customerId: binh, startDate: "2026-10-01", paid: 5_000_000, closed: true });
      await seedInstallment(db, shop, { customerId: binh, startDate: "2026-10-01", deleted: true });
      await seedCash(db, shop, { date: "2026-10-06", type: "installment_payment", amount: 400_000, installmentContractId: onTime });
      // Khách chỉ có trả góp vẫn đếm vào "đang có hợp đồng mở".
      const hoa = await seedCustomer(db, shop.shopId, { fullName: "Lê Thị Hoa" });
      await seedInstallment(db, shop, { customerId: hoa, startDate: "2026-10-20" });

      const [onlyInstallment, first, second] = await directory(db).list(shop.shopId, ALL, TODAY, null, 50);
      expect(onlyInstallment).toMatchObject({ fullName: "Lê Thị Hoa", openContracts: 1, overdueContracts: 0, lastActivity: null });
      expect(onlyInstallment.debt.toBigInt()).toBe(5_000_000n);
      expect(first).toMatchObject({
        fullName: "Nguyễn Văn Bình",
        phone: "091****678",
        address: "12 Lê Lợi",
        cccdMasked: null,
        openContracts: 4,
        overdueContracts: 2,
        lastActivity: "2026-10-06",
      });
      // 8.000.000 gốc + 5.000.000 + 4.600.000 trả góp còn phải thu.
      expect(first.debt.toBigInt()).toBe(17_600_000n);
      expect(second).toMatchObject({ fullName: "Khách", openContracts: 0, overdueContracts: 0, lastActivity: null });
      expect(second.debt.isZero()).toBe(true);
      expect(await directory(db).totals(shop.shopId)).toEqual({ customers: 3, withOpenContracts: 2 });
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

  it("lọc đang có HĐ mở / có HĐ quá hạn (cả trả góp); phân trang keyset mới nhất trước", () =>
    inTx(async (db) => {
      const shop = await seedShop(db);
      const a = await seedCustomer(db, shop.shopId, { fullName: "A" });
      const b = await seedCustomer(db, shop.shopId, { fullName: "B" });
      await seedContract(db, shop, { customerId: a, outstanding: 1_000_000, paidUntil: "2026-10-01" }); // quá hạn
      await seedContract(db, shop, { customerId: b, outstanding: 1_000_000, paidUntil: "2026-10-20" }); // chưa tới hạn
      // C chỉ có trả góp chậm góp, D chỉ có trả góp đã đóng.
      const c = await seedCustomer(db, shop.shopId, { fullName: "C" });
      const d = await seedCustomer(db, shop.shopId, { fullName: "D" });
      await seedInstallment(db, shop, { customerId: c, startDate: "2026-10-10" });
      await seedInstallment(db, shop, { customerId: d, startDate: "2026-10-01", paid: 5_000_000, closed: true });

      expect(await names(db, shop.shopId, { filter: "open" })).toEqual(["C", "B", "A"]);
      expect(await names(db, shop.shopId, { filter: "overdue" })).toEqual(["C", "A"]);
      const page1 = await directory(db).list(shop.shopId, ALL, TODAY, null, 2);
      expect(page1.map((x) => x.fullName)).toEqual(["D", "C"]);
      const page2 = await directory(db).list(shop.shopId, ALL, TODAY, page1[1].id, 2);
      expect(page2.map((x) => x.fullName)).toEqual(["B", "A"]);
    }));

  it("cách ly cửa hàng: B không thấy khách, không khớp CCCD, không đếm khách của A", () =>
    inTx(async (db) => {
      const a = await seedShop(db);
      await seedCustomer(db, a.shopId, { fullName: "Nguyễn Văn Bình", cccdHash: hash(a.shopId, "001099012345") });
      await seedContract(db, a, { outstanding: 1_000_000, paidUntil: "2026-10-01" });
      await seedInstallment(db, a, { startDate: "2026-10-10" });
      const b = await seedShop(db);
      expect(await names(db, b.shopId, {})).toEqual(["Khách"]);
      expect(await names(db, b.shopId, { search: "binh" })).toEqual([]);
      expect(await names(db, b.shopId, { cccd: "001099012345" })).toEqual([]);
      expect(await directory(db).totals(b.shopId)).toEqual({ customers: 1, withOpenContracts: 0 });
    }));
});
