import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// Giới hạn đăng ký theo IP, đếm trong login_throttles với scope 'signup' (data-model mục 3.2).
// Đếm mọi lần gửi form hợp lệ, kể cả lần báo trùng tên đăng nhập, để chặn cả spam cửa hàng lẫn dò tên.
export const SIGNUP_RULE = { maxAttempts: 5, windowSeconds: 60 * 60 } as const;

/** Giữ chỗ một lần đăng ký (atomic). Trả `false` khi IP đã dùng hết lượt trong cửa sổ hiện tại. */
export async function reserveSignupAttempt(db: NodePgDatabase<Record<string, unknown>>, ip: string): Promise<boolean> {
  const expired = sql`t.window_started_at <= now() - make_interval(secs => ${SIGNUP_RULE.windowSeconds})`;
  const { rows } = await db.execute<{ attempts: number }>(sql`
    INSERT INTO login_throttles AS t (scope, key, attempts)
    VALUES ('signup', ${ip}, 1)
    ON CONFLICT (scope, key) DO UPDATE SET
      attempts = CASE WHEN ${expired} THEN 1 ELSE t.attempts + 1 END,
      window_started_at = CASE WHEN ${expired} THEN now() ELSE t.window_started_at END
    RETURNING t.attempts`);
  return rows[0].attempts <= SIGNUP_RULE.maxAttempts;
}
