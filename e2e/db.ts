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
