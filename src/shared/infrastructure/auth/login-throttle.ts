import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// Khoá đăng nhập theo IP và theo username, đếm trong bảng login_throttles (data-model mục 3.2).
// Mỗi lần thử được giữ chỗ trước khi kiểm mật khẩu (atomic, request song song không lọt qua);
// đăng nhập đúng thì xoá bộ đếm username và trả lại chỗ đã giữ cho IP, nên thực chất chỉ đếm lần sai.
export const THROTTLE_RULES = {
  user: { maxAttempts: 5, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
  // Rộng hơn vì nhiều nhân viên một tiệm dùng chung IP.
  ip: { maxAttempts: 20, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
} as const;

export type LoginAttempt = { username: string; ip: string | null };

type Db = NodePgDatabase<Record<string, unknown>>;

function keys({ username, ip }: LoginAttempt): SQL[] {
  const rows = [sql`('user', ${username.toLowerCase()}, 1)`];
  if (ip) rows.push(sql`('ip', ${ip}, 1)`);
  return rows;
}

const rule = (field: keyof (typeof THROTTLE_RULES)["user"]) =>
  sql`(CASE t.scope WHEN 'ip' THEN ${THROTTLE_RULES.ip[field]}::int ELSE ${THROTTLE_RULES.user[field]}::int END)`;

/** Giữ chỗ một lần thử. Trả `false` khi IP hoặc username đang bị khoá (lần thử này không được kiểm mật khẩu). */
export async function reserveLoginAttempt(db: Db, attempt: LoginAttempt): Promise<boolean> {
  // Hết khoá, hoặc chưa khoá mà cửa sổ đếm đã qua: bắt đầu đếm lại từ 1.
  const restart = sql`(t.locked_until IS NOT NULL AND t.locked_until <= now())
    OR (t.locked_until IS NULL AND t.window_started_at <= now() - make_interval(secs => ${rule("windowSeconds")}))`;
  const { rows } = await db.execute<{ locked: boolean }>(sql`
    INSERT INTO login_throttles AS t (scope, key, attempts)
    VALUES ${sql.join(keys(attempt), sql`, `)}
    ON CONFLICT (scope, key) DO UPDATE SET
      attempts = CASE WHEN ${restart} THEN 1 ELSE t.attempts + 1 END,
      window_started_at = CASE WHEN ${restart} THEN now() ELSE t.window_started_at END,
      locked_until = CASE
        WHEN ${restart} THEN NULL
        WHEN t.locked_until IS NULL AND t.attempts + 1 > ${rule("maxAttempts")}
          THEN now() + make_interval(secs => ${rule("lockSeconds")})
        ELSE t.locked_until
      END
    RETURNING t.locked_until IS NOT NULL AS locked`);
  return !rows.some((r) => r.locked);
}

/** Đăng nhập đúng: xoá bộ đếm username, trả lại chỗ đã giữ cho IP (không reset IP, kẻo một tài khoản thật xoá được bộ đếm IP). */
export async function releaseLoginAttempt(db: Db, attempt: LoginAttempt): Promise<void> {
  await db.execute(sql`
    WITH cleared AS (DELETE FROM login_throttles WHERE scope = 'user' AND key = ${attempt.username.toLowerCase()})
    UPDATE login_throttles SET attempts = greatest(attempts - 1, 0)
    WHERE scope = 'ip' AND key = ${attempt.ip} AND locked_until IS NULL`);
}
