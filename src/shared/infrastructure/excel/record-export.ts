import "server-only";
import { db } from "../db/client";
import { auditLogs } from "../db/schema";

/** Dữ liệu được xuất; ghi vào `audit_logs.entity`. */
export type ExportEntity = "contract" | "installment_contract" | "cash";

/**
 * Nhật ký xuất Excel: `entity_id` = cửa hàng (xuất cả danh sách, không gắn một bản ghi), `action = export`.
 * Không ghi tham số lọc (có thể chứa CCCD, SĐT khách).
 */
export async function recordExport(actor: { shopId: string; userId: string }, entity: ExportEntity): Promise<void> {
  await db.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity, entityId: actor.shopId, action: "export" });
}
