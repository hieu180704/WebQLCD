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
  const row = await loadAccess(db, session.user.id);
  return row && { ...row, sessionId: session.session.id };
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

/** Như requireSession (mọi vai trò, không đòi quyền ghi), kèm id phiên hiện tại: đổi mật khẩu giữ phiên này, xoá các phiên khác. */
export async function requireCurrentSession(): Promise<Principal & { sessionId: string }> {
  const row = await loadSession();
  if (!row?.isActive) redirect(SIGN_IN_ROUTE);
  return { ...checkAccess(row), sessionId: row.sessionId };
}

/** Như requireSession, kèm tên người dùng và cửa hàng cho khung trang. */
export async function requireProfile(): Promise<Principal & SessionProfile> {
  const row = await loadSession();
  if (!row?.isActive) redirect(SIGN_IN_ROUTE);
  return { ...checkAccess(row), userName: row.userName, shopName: row.shopName };
}
