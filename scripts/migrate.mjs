// Production: chạy migration bằng role sở hữu bảng rồi cấp quyền cho role runtime (data-model mục 5).
// Dev vẫn dùng `npm run db:migrate` (drizzle-kit, devDependency, không có trong image).
//   MIGRATE_DATABASE_URL  chuỗi kết nối role sở hữu DB
//   APP_DB_ROLE           tên role runtime (ứng dụng kết nối bằng role này)
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.MIGRATE_DATABASE_URL;
const appRole = process.env.APP_DB_ROLE;
if (!url || !appRole) {
  console.error("Thiếu MIGRATE_DATABASE_URL hoặc APP_DB_ROLE");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  // Chạy lại sau mỗi lần migrate để bảng mới cũng được cấp quyền. Sổ két và audit chỉ được thêm:
  // thu quyền UPDATE/DELETE ở tầng role, ngoài trigger append-only (role runtime không tắt được trigger).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('webqlcd.app_role', $1, true)", [appRole]);
    await client.query(`DO $$
      DECLARE r text := current_setting('webqlcd.app_role');
      BEGIN
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', r);
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON cash_transactions, audit_logs FROM %I', r);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', r);
      END $$`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log(`Đã migrate và cấp quyền cho role ${appRole}`);
} finally {
  await pool.end();
}
