// Dữ liệu dev: 1 cửa hàng đang dùng thử + 1 chủ tiệm. Chạy lại được: tài khoản đã có thì đặt lại mật khẩu.
// Chạy: npm run db:seed (cần DATABASE_URL, đã migrate). Mật khẩu đổi được qua SEED_OWNER_PASSWORD.
import { Pool } from "pg";
import { MIN_PASSWORD_LENGTH, hashPassword } from "../src/shared/infrastructure/auth/password.ts";

try {
  process.loadEnvFile();
} catch {
  // Không có .env: dùng biến môi trường sẵn có.
}

if (process.env.NODE_ENV === "production") throw new Error("Không chạy seed dev ở production");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Thiếu biến môi trường DATABASE_URL");

const SEED_OWNER = {
  username: "chutiem",
  password: process.env.SEED_OWNER_PASSWORD ?? "matkhau123",
};
if (SEED_OWNER.password.length < MIN_PASSWORD_LENGTH) throw new Error(`Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`);

const pool = new Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  const passwordHash = await hashPassword(SEED_OWNER.password);
  const existing = await c.query<{ id: string }>(`SELECT id FROM users WHERE lower(username) = $1`, [SEED_OWNER.username]);
  if (existing.rows[0]) {
    const userId = existing.rows[0].id;
    await c.query(`UPDATE users SET is_active = true WHERE id = $1`, [userId]);
    await c.query(`UPDATE accounts SET password = $2 WHERE user_id = $1 AND provider_id = 'credential'`, [userId, passwordHash]);
    console.log(`Đã có tài khoản ${SEED_OWNER.username}: đặt lại mật khẩu.`);
  } else {
    const shop = await c.query<{ id: string }>(
      `INSERT INTO shops (name, opened_at, trial_ends_at)
       VALUES ('Tiệm Dev', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, now() + interval '7 days') RETURNING id`,
    );
    const user = await c.query<{ id: string }>(
      `INSERT INTO users (shop_id, name, email, email_verified, username, display_username, role)
       VALUES ($1, 'Chủ tiệm Dev', 'chutiem@example.com', true, $2, $2, 'owner') RETURNING id`,
      [shop.rows[0].id, SEED_OWNER.username],
    );
    await c.query(
      `INSERT INTO accounts (user_id, account_id, provider_id, password) VALUES ($1, $2, 'credential', $3)`,
      [user.rows[0].id, user.rows[0].id, passwordHash],
    );
    console.log(`Đã tạo cửa hàng 'Tiệm Dev' và chủ tiệm ${SEED_OWNER.username}.`);
  }
  await c.query("COMMIT");
} catch (error) {
  await c.query("ROLLBACK");
  throw error;
} finally {
  c.release();
  await pool.end();
}
