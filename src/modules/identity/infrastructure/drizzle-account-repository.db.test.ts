// Repository tài khoản trên PostgreSQL thật (cần DATABASE_URL, đã migrate).
// Mỗi test chạy trong một transaction ngoài rồi rollback; transaction của repository thành savepoint bên trong.
import { TransactionRollbackError, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@/shared/infrastructure/auth/password";
import type { Db } from "@/shared/infrastructure/db/client";
import * as schema from "@/shared/infrastructure/db/schema";
import type { OwnerRegistration } from "../application/ports";
import { DrizzleAccountRepository } from "./drizzle-account-repository";

const url = process.env.DATABASE_URL;
const MONTH = "2026-10-01";

describe.skipIf(!url)("DrizzleAccountRepository", () => {
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

  let n = 0;
  const owner = (overrides: Partial<OwnerRegistration> = {}): OwnerRegistration => {
    const id = `repo_${Date.now()}_${n++}`;
    return { shopName: "Tiệm Test", ownerName: "Chủ Test", email: `${id}@example.com`, username: id, password: "matkhau123", ...overrides };
  };

  async function findUser(db: Db, username: string) {
    const [row] = await db
      .select({
        id: schema.users.id,
        shopId: schema.users.shopId,
        role: schema.users.role,
        username: schema.users.username,
        displayUsername: schema.users.displayUsername,
        email: schema.users.email,
        password: schema.accounts.password,
        providerId: schema.accounts.providerId,
        accountId: schema.accounts.accountId,
      })
      .from(schema.users)
      .innerJoin(schema.accounts, eq(schema.accounts.userId, schema.users.id))
      .where(sql`lower(${schema.users.username}) = lower(${username})`);
    return row;
  }

  it("đăng ký: cửa hàng dùng thử N ngày, chủ tiệm có tài khoản credential đúng hình dạng Better Auth", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const input = owner({ username: `Repo_Hoa_${n++}` });
      expect(await repo.registerOwner(input, 7)).toBe("ok");

      const user = await findUser(db, input.username);
      expect(user).toMatchObject({
        role: "owner",
        username: input.username.toLowerCase(),
        displayUsername: input.username,
        email: input.email,
        providerId: "credential",
        accountId: user.id,
      });
      expect(await verifyPassword(user.password!, input.password)).toBe(true);

      const { rows } = await db.execute<{ trial_days: number; opened_today: boolean; status: string }>(
        sql`SELECT
          round(extract(epoch FROM trial_ends_at - now()) / 86400)::int AS trial_days,
          opened_at = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS opened_today,
          subscription_status AS status
        FROM shops WHERE id = ${user.shopId}`,
      );
      expect(rows[0]).toEqual({ trial_days: 7, opened_today: true, status: "trial" });
    }));

  it("trùng tên đăng nhập (khác hoa thường) hoặc email: báo đúng lỗi, không để lại cửa hàng mồ côi", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const first = owner();
      await repo.registerOwner(first, 7);
      const countShops = async () =>
        (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM shops`)).rows[0].n;
      const before = await countShops();

      expect(await repo.registerOwner(owner({ username: first.username.toUpperCase() }), 7)).toBe("username_taken");
      expect(await repo.registerOwner(owner({ email: first.email }), 7)).toBe("email_taken");
      expect(await countShops()).toBe(before);
    }));

  it("KTV: thuộc cửa hàng của người tạo, email nội bộ .invalid, có audit; cửa hàng khác không thấy", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);

      const staffName = `ktv_${Date.now()}_${n++}`;
      expect(await repo.createStaff({ userId: ownerA.id, shopId: ownerA.shopId }, { name: "KTV Lan", username: staffName, password: "matkhau456" })).toBe("ok");
      const staff = await findUser(db, staffName);
      expect(staff).toMatchObject({ shopId: ownerA.shopId, role: "staff", providerId: "credential" });
      expect(staff.email).toMatch(/^staff-[0-9a-f-]{36}@tp83\.invalid$/);

      const { rows } = await db.execute<{ user_id: string; action: string }>(
        sql`SELECT user_id, action FROM audit_logs WHERE entity = 'user' AND entity_id = ${staff.id}`,
      );
      expect(rows).toEqual([{ user_id: ownerA.id, action: "create" }]);

      expect((await repo.listStaff(ownerA.shopId, 10, MONTH)).map((s) => s.username)).toEqual([a.username, staffName]);
      expect((await repo.listStaff(ownerB.shopId, 10, MONTH)).map((s) => s.username)).toEqual([b.username]);
      expect(await repo.createStaff({ userId: ownerB.id, shopId: ownerB.shopId }, { name: "Trùng", username: staffName, password: "matkhau456" })).toBe(
        "username_taken",
      );
    }));

  it("người thực hiện không thuộc cửa hàng thì không tạo được KTV", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);
      const staffName = `ktv_${Date.now()}_${n++}`;

      await expect(
        repo.createStaff({ userId: ownerA.id, shopId: ownerB.shopId }, { name: "Lạ", username: staffName, password: "matkhau456" }),
      ).rejects.toThrow();
      expect(await findUser(db, staffName)).toBeUndefined();
    }));

  it("khoá KTV: xoá mọi phiên, có audit; mở khoá lại được; khoá lần hai báo not_found", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      await repo.registerOwner(a, 7);
      const ownerA = await findUser(db, a.username);
      const actor = { userId: ownerA.id, shopId: ownerA.shopId };
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff(actor, { name: "KTV Khoá", username: staffName, password: "matkhau456" });
      const staff = await findUser(db, staffName);
      const session = (userId: string) => ({ userId, token: `t_${Date.now()}_${n++}`, expiresAt: new Date(Date.now() + 3_600_000) });
      await db.insert(schema.sessions).values([session(staff.id), session(staff.id), session(ownerA.id)]);
      const countSessions = async (userId: string) =>
        (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${userId}`)).rows[0].n;
      const isActive = async () => (await repo.listStaff(ownerA.shopId, 10, MONTH)).find((m) => m.id === staff.id)!.isActive;

      expect(await repo.setStaffActive(actor, staff.id, false)).toBe("ok");
      expect(await isActive()).toBe(false);
      expect(await countSessions(staff.id)).toBe(0);
      expect(await countSessions(ownerA.id)).toBe(1);
      expect(await repo.setStaffActive(actor, staff.id, false)).toBe("not_found");

      expect(await repo.setStaffActive(actor, staff.id, true)).toBe("ok");
      expect(await isActive()).toBe(true);

      const { rows } = await db.execute<{ user_id: string; action: string }>(
        sql`SELECT user_id, action FROM audit_logs WHERE entity = 'user' AND entity_id = ${staff.id} ORDER BY id`,
      );
      expect(rows).toEqual([
        { user_id: ownerA.id, action: "create" },
        { user_id: ownerA.id, action: "lock" },
        { user_id: ownerA.id, action: "unlock" },
      ]);
    }));

  it("khoá: không đụng được chủ tiệm, không đụng được KTV cửa hàng khác", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);
      const actorA = { userId: ownerA.id, shopId: ownerA.shopId };
      const actorB = { userId: ownerB.id, shopId: ownerB.shopId };
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff(actorA, { name: "KTV A", username: staffName, password: "matkhau456" });
      const staffA = await findUser(db, staffName);

      expect(await repo.setStaffActive(actorA, ownerA.id, false)).toBe("not_found");
      expect(await repo.setStaffActive(actorB, staffA.id, false)).toBe("not_found");
      // Giả mạo shopId của cửa hàng A với người thực hiện thuộc cửa hàng B: khoá ngoại audit chặn, cả transaction rollback.
      await expect(repo.setStaffActive({ userId: ownerB.id, shopId: ownerA.shopId }, staffA.id, false)).rejects.toThrow();
      expect((await repo.listStaff(ownerA.shopId, 10, MONTH)).find((m) => m.id === staffA.id)!.isActive).toBe(true);
    }));

  it("đặt lại mật khẩu KTV: mật khẩu mới dùng được, cũ hết dùng được, xoá mọi phiên KTV, có audit", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      await repo.registerOwner(a, 7);
      const ownerA = await findUser(db, a.username);
      const actor = { userId: ownerA.id, shopId: ownerA.shopId };
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff(actor, { name: "KTV Quên", username: staffName, password: "matkhau456" });
      const staff = await findUser(db, staffName);
      const token = () => `t_${Date.now()}_${n++}`;
      const expiresAt = new Date(Date.now() + 3_600_000);
      await db.insert(schema.sessions).values([
        { userId: staff.id, token: token(), expiresAt },
        { userId: ownerA.id, token: token(), expiresAt },
      ]);

      expect(await repo.resetStaffPassword(actor, staff.id, "matkhaumoi789")).toBe("ok");
      const after = await findUser(db, staffName);
      expect(await verifyPassword(after.password!, "matkhaumoi789")).toBe(true);
      expect(await verifyPassword(after.password!, "matkhau456")).toBe(false);
      const { rows: left } = await db.execute<{ user_id: string }>(
        sql`SELECT user_id FROM sessions WHERE user_id IN (${staff.id}, ${ownerA.id})`,
      );
      expect(left).toEqual([{ user_id: ownerA.id }]);

      const { rows } = await db.execute<{ user_id: string; action: string }>(
        sql`SELECT user_id, action FROM audit_logs WHERE entity = 'user' AND entity_id = ${staff.id} AND action = 'reset_password'`,
      );
      expect(rows).toEqual([{ user_id: ownerA.id, action: "reset_password" }]);
    }));

  it("đặt lại mật khẩu: không đụng được chủ tiệm, không đụng được KTV cửa hàng khác", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);
      const actorA = { userId: ownerA.id, shopId: ownerA.shopId };
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff(actorA, { name: "KTV A", username: staffName, password: "matkhau456" });
      const staffA = await findUser(db, staffName);

      expect(await repo.resetStaffPassword(actorA, ownerA.id, "matkhaumoi789")).toBe("not_found");
      expect(await repo.resetStaffPassword({ userId: ownerB.id, shopId: ownerB.shopId }, staffA.id, "matkhaumoi789")).toBe("not_found");
      await expect(repo.resetStaffPassword({ userId: ownerB.id, shopId: ownerA.shopId }, staffA.id, "matkhaumoi789")).rejects.toThrow();
      expect(await verifyPassword((await findUser(db, staffName)).password!, "matkhau456")).toBe(true);
      expect(await verifyPassword((await findUser(db, a.username)).password!, a.password)).toBe(true);
    }));

  it("danh sách nhân viên: chủ tiệm trước, đếm hợp đồng chưa xoá tạo trong tháng theo KTV, đăng nhập gần nhất", () =>
    inTx(async (db) => {
      const repo = new DrizzleAccountRepository(db);
      const a = owner();
      const b = owner();
      await repo.registerOwner(a, 7);
      await repo.registerOwner(b, 7);
      const ownerA = await findUser(db, a.username);
      const ownerB = await findUser(db, b.username);
      const staffName = `ktv_${Date.now()}_${n++}`;
      await repo.createStaff({ userId: ownerA.id, shopId: ownerA.shopId }, { name: "KTV Đếm", username: staffName, password: "matkhau456" });
      const staff = await findUser(db, staffName);
      const loginAt = new Date("2026-10-20T01:02:03Z");
      await db.update(schema.users).set({ lastLoginAt: loginAt }).where(sql`${schema.users.id} = ${staff.id}`);

      const customer = async (shopId: string) =>
        (await db.insert(schema.customers).values({ shopId, fullName: "Khách" }).returning({ id: schema.customers.id }))[0].id;
      const customerA = await customer(ownerA.shopId);
      const customerB = await customer(ownerB.shopId);
      let code = 0;
      const contract = (shopId: string, customerId: string, staffId: string, createdAt: string, deleted = false) => ({
        shopId,
        code: `TC-${code++}`,
        customerId,
        kind: "unsecured" as const,
        principal: 1_000_000n,
        outstandingPrincipal: 1_000_000n,
        interestType: "per_million_per_day" as const,
        interestRate: "3",
        interestPeriodDays: 10,
        termDays: 30,
        loanDate: "2026-09-01",
        interestPaidUntil: "2026-09-01",
        staffId,
        createdAt: new Date(createdAt),
        ...(deleted ? { deletedAt: new Date(createdAt), deletedBy: staffId, deletedReason: "Nhập nhầm" } : {}),
      });
      await db.insert(schema.contracts).values([
        // 00:30 ngày 01/10 giờ Việt Nam = 17:30 ngày 30/09 UTC: vẫn tính vào tháng 10.
        contract(ownerA.shopId, customerA, staff.id, "2026-09-30T17:30:00Z"),
        contract(ownerA.shopId, customerA, staff.id, "2026-10-15T03:00:00Z"),
        contract(ownerA.shopId, customerA, staff.id, "2026-10-16T03:00:00Z", true),
        contract(ownerA.shopId, customerA, staff.id, "2026-09-30T16:59:00Z"),
        contract(ownerA.shopId, customerA, ownerA.id, "2026-10-02T03:00:00Z"),
        contract(ownerB.shopId, customerB, ownerB.id, "2026-10-02T03:00:00Z"),
      ]);
      const installment = (shopId: string, customerId: string, staffId: string, createdAt: string, deleted = false) => ({
        shopId,
        code: `TG-${code++}`,
        customerId,
        amountGiven: 4_000_000n,
        totalDue: 5_000_000n,
        totalDays: 50,
        periodDays: 2,
        startDate: "2026-10-01",
        staffId,
        createdAt: new Date(createdAt),
        ...(deleted ? { deletedAt: new Date(createdAt), deletedBy: staffId, deletedReason: "Nhập nhầm" } : {}),
      });
      await db.insert(schema.installmentContracts).values([
        installment(ownerA.shopId, customerA, staff.id, "2026-10-03T03:00:00Z"),
        installment(ownerA.shopId, customerA, staff.id, "2026-10-04T03:00:00Z", true),
        installment(ownerA.shopId, customerA, staff.id, "2026-09-30T16:59:00Z"),
        installment(ownerB.shopId, customerB, ownerB.id, "2026-10-02T03:00:00Z"),
      ]);

      const rows = await repo.listStaff(ownerA.shopId, 10, MONTH);
      expect(rows.map((m) => ({ role: m.role, contracts: m.contractsThisMonth, lastLoginAt: m.lastLoginAt }))).toEqual([
        { role: "owner", contracts: 1, lastLoginAt: null },
        { role: "staff", contracts: 3, lastLoginAt: loginAt },
      ]);
    }));
});
