import "server-only";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { shops, users } from "../db/schema";

export type Role = "owner" | "staff";

/** Danh tính đã xác thực. shopId, role chỉ lấy từ đây, không bao giờ từ input của client. */
export type Principal = { userId: string; shopId: string; role: Role };

export type AccessOptions = {
  /** Vai trò bắt buộc; bỏ trống = mọi vai trò. */
  role?: Role;
  /** Thao tác ghi: cửa hàng hết dùng thử / hết hạn thuê bao thì chỉ được đọc. */
  write?: boolean;
};

export type AccessRow = Principal & { isActive: boolean; canWrite: boolean };

/** Tên hiển thị ở khung trang; chỉ để hiển thị, không dùng cho quyền. */
export type SessionProfile = { userName: string; shopName: string };

export class AccessDeniedError extends Error {
  constructor(readonly reason: "inactive" | "role" | "read_only") {
    super(`Không có quyền: ${reason}`);
    this.name = "AccessDeniedError";
  }
}

export function checkAccess(row: AccessRow, options: AccessOptions = {}): Principal {
  if (!row.isActive) throw new AccessDeniedError("inactive");
  if (options.role && row.role !== options.role) throw new AccessDeniedError("role");
  if (options.write && !row.canWrite) throw new AccessDeniedError("read_only");
  return { userId: row.userId, shopId: row.shopId, role: row.role };
}

/** Người dùng + quyền ghi của cửa hàng trong một truy vấn; quyền ghi tính bằng giờ DB. */
export async function loadAccess(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
): Promise<(AccessRow & SessionProfile) | undefined> {
  const [row] = await db
    .select({
      userId: users.id,
      shopId: users.shopId,
      role: users.role,
      isActive: users.isActive,
      userName: users.name,
      shopName: shops.name,
      canWrite: sql<boolean>`CASE ${shops.subscriptionStatus}
        WHEN 'trial' THEN ${shops.trialEndsAt} > now()
        WHEN 'active' THEN coalesce(${shops.paidUntil} > now(), false)
        ELSE false END`,
    })
    .from(users)
    .innerJoin(shops, eq(shops.id, users.shopId))
    .where(eq(users.id, userId));
  return row;
}
