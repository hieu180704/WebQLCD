import { Pool } from "pg";

export async function clearLoginThrottles() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("DELETE FROM login_throttles");
  } finally {
    await pool.end();
  }
}

export async function countIpThrottles(): Promise<number> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM login_throttles WHERE scope = 'ip'`);
    return rows[0].n;
  } finally {
    await pool.end();
  }
}

export async function setUserActive(username: string, isActive: boolean) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(`UPDATE users SET is_active = $2 WHERE lower(username) = $1`, [username, isActive]);
  } finally {
    await pool.end();
  }
}

/** Cho cửa hàng của người dùng hết hạn dùng thử (kiểm chế độ chỉ đọc). */
export async function expireTrial(username: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(
      `UPDATE shops SET trial_ends_at = now() - interval '1 second'
       WHERE id = (SELECT shop_id FROM users WHERE lower(username) = lower($1))`,
      [username],
    );
  } finally {
    await pool.end();
  }
}

/** Số dòng nhật ký `action` trên `entity` của cửa hàng có người dùng `username`. */
export async function countAudit(username: string, entity: string, action: string): Promise<number> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE entity = $2 AND action = $3 AND shop_id = (SELECT shop_id FROM users WHERE lower(username) = lower($1))`,
      [username, entity, action],
    );
    return rows[0].n;
  } finally {
    await pool.end();
  }
}
