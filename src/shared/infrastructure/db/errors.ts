import "server-only";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

/**
 * DrizzleQueryError mang theo tham số truy vấn (CCCD mã hoá, SĐT, hash mật khẩu…):
 * chỉ ném lại lỗi gốc của PostgreSQL để dữ liệu nhạy cảm không lọt vào log.
 */
export function dbCause(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause ? error.cause : error;
}

/** Tên ràng buộc UNIQUE bị vi phạm (mã 23505), hoặc undefined nếu là lỗi khác. */
export function uniqueViolation(error: unknown): string | undefined {
  const cause = dbCause(error);
  return cause instanceof DatabaseError && cause.code === "23505" ? cause.constraint : undefined;
}
