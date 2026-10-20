import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getIP, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { reserveLoginAttempt, releaseLoginAttempt, type LoginAttempt } from "./login-throttle";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "./password";

// Mã lỗi riêng, adapter của module identity dịch sang thông báo tiếng Việt.
export const AUTH_ERROR_CODES = {
  loginLocked: "LOGIN_LOCKED",
  accountInactive: "ACCOUNT_INACTIVE",
} as const;

const SIGN_IN_PATH = "/sign-in/username";

// Không mount route /api/auth: mọi lời gọi đi qua auth.api từ server action, nên rate limit gốc của
// Better Auth (chỉ chạy trong HTTP router) không có tác dụng. Khoá đăng nhập làm ở hook bên dưới.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
  advanced: {
    database: { generateId: false }, // DB tự sinh uuidv7.
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  rateLimit: { enabled: false },
  // Cột bắt buộc của users mà Better Auth không tự ghi; input: false để không nhận từ client.
  user: {
    additionalFields: {
      shopId: { type: "string", required: true, input: false },
      role: { type: "string", required: true, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // Luồng đăng ký chủ tiệm làm ở bước 5.
    minPasswordLength: MIN_PASSWORD_LENGTH,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [user] = await db
            .select({ isActive: schema.users.isActive })
            .from(schema.users)
            .where(eq(schema.users.id, session.userId));
          if (!user?.isActive) {
            throw new APIError("FORBIDDEN", {
              code: AUTH_ERROR_CODES.accountInactive,
              message: "Tài khoản đã bị vô hiệu hoá",
            });
          }
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;
      const attempt = loginAttempt(ctx);
      if (attempt && !(await reserveLoginAttempt(db, attempt))) {
        throw new APIError("TOO_MANY_REQUESTS", {
          code: AUTH_ERROR_CODES.loginLocked,
          message: "Đăng nhập sai quá nhiều lần",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH || isAPIError(ctx.context.returned)) return;
      const attempt = loginAttempt(ctx);
      if (attempt) await releaseLoginAttempt(db, attempt);
    }),
  },
  // nextCookies phải đứng cuối danh sách plugin.
  plugins: [username(), nextCookies()],
});

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function loginAttempt(ctx: HookContext): LoginAttempt | null {
  const name: unknown = ctx.body?.username;
  if (typeof name !== "string" || name === "") return null;
  const source = ctx.request ?? ctx.headers;
  return { username: name, ip: source ? getIP(source, ctx.context.options) : null };
}
