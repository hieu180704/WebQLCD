import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Một pool dùng chung cho toàn ứng dụng; giữ trên globalThis để hot reload ở dev không mở thêm pool.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Thiếu biến môi trường DATABASE_URL");
  return new Pool({ connectionString, max: 10 });
}

export const pool = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle({ client: pool, schema });
export type Db = typeof db;
/** Transaction đang mở, truyền giữa các module khi một thao tác ghi nhiều bảng (architecture-spec mục 2.2). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
