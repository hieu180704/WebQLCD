import "server-only";
import { randomUUID } from "node:crypto";
import { DrizzleQueryError, and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import { hashPassword } from "@/shared/infrastructure/auth/password";
import type { Db } from "@/shared/infrastructure/db/client";
import { accounts, auditLogs, contracts, installmentContracts, sessions, shops, users } from "@/shared/infrastructure/db/schema";
import { BUSINESS_TIME_ZONE } from "@/shared/kernel/local-date";
import type {
  Actor,
  CreateStaffResult,
  NewStaff,
  OwnerRegistrar,
  OwnerRegistration,
  RegisterOwnerResult,
  ResetStaffPasswordResult,
  SetStaffActiveResult,
  StaffMember,
  StaffRepository,
} from "../application/ports";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type NewUser = { shopId: string; role: "owner" | "staff"; name: string; email: string; username: string };

// Ghi thẳng bảng của Better Auth (users + accounts dòng 'credential', account_id = user id) trong transaction
// của mình để cửa hàng và chủ tiệm cùng có hoặc cùng không (Docs/Decisions/2026-10-20-signup-direct-insert.txt).
export class DrizzleAccountRepository implements OwnerRegistrar, StaffRepository {
  constructor(private readonly db: Db) {}

  async registerOwner(input: OwnerRegistration, trialDays: number): Promise<Exclude<RegisterOwnerResult, "rate_limited">> {
    const passwordHash = await hashPassword(input.password); // Băm trước, không giữ transaction trong lúc băm.
    try {
      await this.db.transaction(async (tx) => {
        const [shop] = await tx
          .insert(shops)
          .values({
            name: input.shopName,
            openedAt: sql`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
            trialEndsAt: sql`now() + make_interval(days => ${trialDays})`,
          })
          .returning({ id: shops.id });
        const user = { shopId: shop.id, role: "owner", name: input.ownerName, email: input.email, username: input.username } as const;
        await insertUser(tx, user, passwordHash);
      });
      return "ok";
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === USERNAME_KEY) return "username_taken";
      if (constraint === EMAIL_KEY) return "email_taken";
      throw dbCause(error);
    }
  }

  async createStaff(actor: Actor, input: NewStaff): Promise<CreateStaffResult> {
    const passwordHash = await hashPassword(input.password);
    try {
      await this.db.transaction(async (tx) => {
        // Email bắt buộc với Better Auth; KTV dùng email nội bộ, TLD .invalid (RFC 2606) không bao giờ gửi được thư.
        const email = `staff-${randomUUID()}@tp83.invalid`;
        const user = { shopId: actor.shopId, role: "staff", name: input.name, email, username: input.username } as const;
        const userId = await insertUser(tx, user, passwordHash);
        // Khoá ngoại (shop_id, user_id) của audit_logs chặn người thực hiện thuộc cửa hàng khác.
        await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "user", entityId: userId, action: "create" });
      });
      return "ok";
    } catch (error) {
      if (uniqueViolation(error) === USERNAME_KEY) return "username_taken";
      throw dbCause(error);
    }
  }

  async listStaff(shopId: string, limit: number, monthStart: string): Promise<StaffMember[]> {
    // Đếm gộp một lần theo staff_id cho mỗi bảng hợp đồng (không truy vấn từng người); ngày tạo so theo giờ Việt Nam.
    const since = sql`(${monthStart}::date::timestamp AT TIME ZONE ${BUSINESS_TIME_ZONE})`;
    const monthly = this.db
      .select({ staffId: contracts.staffId, n: sql<number>`count(*)::int`.as("n") })
      .from(contracts)
      .where(and(eq(contracts.shopId, shopId), isNull(contracts.deletedAt), sql`${contracts.createdAt} >= ${since}`))
      .groupBy(contracts.staffId)
      .as("monthly");
    const i = installmentContracts;
    const monthlyInstallment = this.db
      .select({ staffId: i.staffId, n: sql<number>`count(*)::int`.as("installment_n") })
      .from(i)
      .where(and(eq(i.shopId, shopId), isNull(i.deletedAt), sql`${i.createdAt} >= ${since}`))
      .groupBy(i.staffId)
      .as("monthly_installment");
    return this.db
      .select({
        id: users.id,
        name: users.name,
        username: sql<string>`coalesce(${users.displayUsername}, ${users.username})`,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        contractsThisMonth: sql<number>`coalesce(${monthly.n}, 0) + coalesce(${monthlyInstallment.n}, 0)`.mapWith(Number),
      })
      .from(users)
      .leftJoin(monthly, eq(monthly.staffId, users.id))
      .leftJoin(monthlyInstallment, eq(monthlyInstallment.staffId, users.id))
      .where(eq(users.shopId, shopId))
      .orderBy(sql`${users.role} = 'owner' DESC`, asc(users.createdAt))
      .limit(limit);
  }

  async setStaffActive(actor: Actor, staffId: string, active: boolean): Promise<SetStaffActiveResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ isActive: active })
        .where(and(eq(users.id, staffId), eq(users.shopId, actor.shopId), eq(users.role, "staff"), ne(users.isActive, active)))
        .returning({ id: users.id });
      if (!row) return "not_found";
      // Guard tra is_active ở mọi request nên phiên cũ đã hết dùng được; xoá luôn để DB không còn token sống.
      if (!active) await tx.delete(sessions).where(eq(sessions.userId, staffId));
      await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "user", entityId: staffId, action: active ? "unlock" : "lock" });
      return "ok";
    });
  }

  async resetStaffPassword(actor: Actor, staffId: string, password: string): Promise<ResetStaffPasswordResult> {
    const passwordHash = await hashPassword(password); // Băm trước, không giữ transaction trong lúc băm.
    try {
      return await this.db.transaction(async (tx) => {
        const [staff] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, staffId), eq(users.shopId, actor.shopId), eq(users.role, "staff")))
          .for("update");
        if (!staff) return "not_found";
        await tx
          .update(accounts)
          .set({ password: passwordHash })
          .where(and(eq(accounts.userId, staffId), eq(accounts.providerId, "credential")));
        await tx.delete(sessions).where(eq(sessions.userId, staffId));
        await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "user", entityId: staffId, action: "reset_password" });
        return "ok";
      });
    } catch (error) {
      throw dbCause(error);
    }
  }
}

const USERNAME_KEY = "users_username_lower_key";
const EMAIL_KEY = "users_email_unique";

async function insertUser(tx: Tx, user: NewUser, passwordHash: string): Promise<string> {
  // Plugin username của Better Auth so khớp username viết thường; giữ cách viết gốc ở display_username.
  const [row] = await tx
    .insert(users)
    .values({ ...user, username: user.username.toLowerCase(), displayUsername: user.username })
    .returning({ id: users.id });
  await tx.insert(accounts).values({ userId: row.id, accountId: row.id, providerId: "credential", password: passwordHash });
  return row.id;
}

// DrizzleQueryError mang theo tham số truy vấn (có hash mật khẩu): chỉ ném lại lỗi gốc của PostgreSQL, tránh lọt vào log.
export function dbCause(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause ? error.cause : error;
}

function uniqueViolation(error: unknown): string | undefined {
  const cause = dbCause(error);
  return cause instanceof DatabaseError && cause.code === "23505" ? cause.constraint : undefined;
}
