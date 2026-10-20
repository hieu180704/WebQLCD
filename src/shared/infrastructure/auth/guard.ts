import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../db/client";
import { checkAccess, loadAccess, type AccessOptions, type Principal } from "./access";
import { auth } from "./auth";

export const SIGN_IN_ROUTE = "/dang-nhap";

/**
 * Guard dùng chung: gọi ở đầu mỗi server action / trang cần đăng nhập (không dựa vào proxy.ts).
 * Chưa đăng nhập hoặc tài khoản bị vô hiệu hoá: chuyển về trang đăng nhập.
 * Sai vai trò hoặc ghi khi thuê bao hết hạn: ném AccessDeniedError.
 */
export async function requireSession(options: AccessOptions = {}): Promise<Principal> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(SIGN_IN_ROUTE);
  const row = await loadAccess(db, session.user.id);
  if (!row?.isActive) redirect(SIGN_IN_ROUTE);
  return checkAccess(row, options);
}
