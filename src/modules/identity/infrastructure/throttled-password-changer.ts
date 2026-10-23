import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getIP } from "better-auth/api";
import { headers } from "next/headers";
import { auth } from "@/shared/infrastructure/auth/auth";
import {
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "@/shared/infrastructure/auth/login-throttle";
import {
  hashPassword,
  verifyPassword,
} from "@/shared/infrastructure/auth/password";
import type { Db } from "@/shared/infrastructure/db/client";
import {
  accounts,
  auditLogs,
  sessions,
  users,
} from "@/shared/infrastructure/db/schema";
import type {
  Actor,
  ChangePasswordResult,
  PasswordChange,
  PasswordChanger,
} from "../application/ports";
import { dbCause } from "./drizzle-account-repository";

// Ghi thẳng DB như tạo KTV / đặt lại mật khẩu, để mật khẩu mới, xoá phiên và audit cùng một transaction
// (không dùng auth.api.changePassword: không chen audit vào transaction của nó được).
export class ThrottledPasswordChanger implements PasswordChanger {
  constructor(
    private readonly db: Db,
    private readonly clientIp: () => Promise<string | null> = requestIp,
  ) {}

  async changeOwnPassword(
    actor: Actor,
    sessionId: string,
    input: PasswordChange,
  ): Promise<ChangePasswordResult> {
    const [credential] = await this.db
      .select({ username: users.username, password: accounts.password })
      .from(users)
      .innerJoin(
        accounts,
        and(
          eq(accounts.userId, users.id),
          eq(accounts.providerId, "credential"),
        ),
      )
      .where(and(eq(users.id, actor.userId), eq(users.shopId, actor.shopId)));
    if (!credential?.password)
      throw new Error("Không tìm thấy tài khoản đăng nhập");

    // Cùng bộ đếm với đăng nhập: người cầm phiên không dò được mật khẩu hiện tại quá 5 lần / 15 phút.
    const attempt = {
      username: credential.username,
      ip: await this.clientIp(),
    };
    if (!(await reserveLoginAttempt(this.db, attempt))) return "locked";
    if (!(await verifyPassword(credential.password, input.currentPassword)))
      return "wrong_password";
    await releaseLoginAttempt(this.db, attempt);

    const passwordHash = await hashPassword(input.newPassword); // Băm trước, không giữ transaction trong lúc băm.
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(accounts)
          .set({ password: passwordHash })
          .where(
            and(
              eq(accounts.userId, actor.userId),
              eq(accounts.providerId, "credential"),
            ),
          );
        await tx
          .delete(sessions)
          .where(
            and(eq(sessions.userId, actor.userId), ne(sessions.id, sessionId)),
          );
        await tx
          .insert(auditLogs)
          .values({
            shopId: actor.shopId,
            userId: actor.userId,
            entity: "user",
            entityId: actor.userId,
            action: "change_password",
          });
      });
    } catch (error) {
      throw dbCause(error);
    }
    return "ok";
  }
}

// Xác định IP cùng cách với khoá đăng nhập (cấu hình advanced.ipAddress của Better Auth).
async function requestIp(): Promise<string | null> {
  return getIP(await headers(), auth.options);
}
