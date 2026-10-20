import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db/client";
import { checkAccess, loadAccess, type AccessOptions, type Principal, type SessionProfile } from "./access";
import { auth } from "./auth";

export const SIGN_IN_ROUTE = "/dang-nhap";

// Layout và page cùng gọi guard trong một request: chỉ tra phiên + DB một lần (React.cache theo request).
const loadSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return undefined;
  return loadAccess(db, session.user.id);
});

/**
 * Guard dùng chung: gọi ở đầu mỗi server action / trang cần đăng nhập (không dựa vào proxy.ts).
 * Chưa đăng nhập hoặc tài khoản bị vô hiệu hoá: chuyển về trang đăng nhập.
 * Sai vai trò hoặc ghi khi thuê bao hết hạn: ném AccessDeniedError.
 */
export async function requireSession(options: AccessOptions = {}): Promise<Principal> {
  const row = await loadSession();
  if (!row?.isActive) redirect(SIGN_IN_ROUTE);
  return checkAccess(row, options);
}

/** Như requireSession, kèm tên người dùng và cửa hàng cho khung trang. */
export async function requireProfile(): Promise<Principal & SessionProfile> {
  const row = await loadSession();
  if (!row?.isActive) redirect(SIGN_IN_ROUTE);
  return { ...checkAccess(row), userName: row.userName, shopName: row.shopName };
}
