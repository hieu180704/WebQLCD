import "server-only";
import { randomUUID } from "node:crypto";
import { DrizzleQueryError, and, asc, eq, ne, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import { hashPassword } from "@/shared/infrastructure/auth/password";
import type { Db } from "@/shared/infrastructure/db/client";
import { accounts, auditLogs, sessions, shops, users } from "@/shared/infrastructure/db/schema";
import type {
  Actor,
  CreateStaffResult,
  NewStaff,
  OwnerRegistrar,
  OwnerRegistration,
  RegisterOwnerResult,
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

  async listStaff(shopId: string, limit: number): Promise<StaffMember[]> {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        username: sql<string>`coalesce(${users.displayUsername}, ${users.username})`,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.shopId, shopId), eq(users.role, "staff")))
      .orderBy(asc(users.createdAt))
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
function dbCause(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause ? error.cause : error;
}

function uniqueViolation(error: unknown): string | undefined {
  const cause = dbCause(error);
  return cause instanceof DatabaseError && cause.code === "23505" ? cause.constraint : undefined;
}
