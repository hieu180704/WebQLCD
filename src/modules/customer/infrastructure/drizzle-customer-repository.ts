import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/shared/infrastructure/db/client";
import { uniqueViolation } from "@/shared/infrastructure/db/errors";
import { auditLogs, customers } from "@/shared/infrastructure/db/schema";
import type {
  Actor,
  CustomerEditDraft,
  CustomerField,
  CustomerRepository,
  EditCustomerResult,
} from "../application/ports";
import { cccdColumns, type CccdCipher } from "./cccd-cipher";

/** Tên cột ghi vào audit_logs.changed_fields (chỉ tên field, không lưu giá trị). */
const AUDIT_FIELD: Record<CustomerField, string> = {
  fullName: "full_name",
  phone: "phone",
  address: "address",
  cccd: "cccd",
};

const INFO_FIELDS = ["fullName", "phone", "address"] as const;

export class DrizzleCustomerRepository implements CustomerRepository {
  /** Khoá CCCD lấy lười như DrizzleCustomerWriter. */
  constructor(
    private readonly db: Db,
    private readonly cipher: () => CccdCipher,
  ) {}

  async recordEdit(
    actor: Actor,
    draft: CustomerEditDraft,
  ): Promise<EditCustomerResult> {
    const newCccd = draft.cccd
      ? cccdColumns(this.cipher(), actor.shopId, draft.cccd)
      : null;
    try {
      return await this.db.transaction(
        async (tx): Promise<EditCustomerResult> => {
          const where = and(
            eq(customers.shopId, actor.shopId),
            eq(customers.id, draft.customerId),
          );
          // Khoá dòng: hai người sửa cùng lúc thì người sau so với giá trị người trước đã ghi.
          const [current] = await tx
            .select({
              fullName: customers.fullName,
              phone: customers.phone,
              address: customers.address,
              cccdMasked: customers.cccdMasked,
              cccdHash: customers.cccdHash,
            })
            .from(customers)
            .where(where)
            .for("update");
          if (!current) return { ok: false, error: "not_found" };
          const { expected } = draft;
          if (
            [...INFO_FIELDS, "cccdMasked" as const].some(
              (field) => current[field] !== expected[field],
            )
          )
            return { ok: false, error: "stale" };

          const changed: CustomerField[] = INFO_FIELDS.filter(
            (field) => draft.info[field] !== current[field],
          );
          const cccdChanged =
            newCccd !== null && newCccd.cccdHash !== current.cccdHash;
          if (cccdChanged) changed.push("cccd");
          if (changed.length === 0) return { ok: true, changed };

          await tx
            .update(customers)
            .set({ ...draft.info, ...(cccdChanged ? newCccd : {}) })
            .where(where);
          await tx.insert(auditLogs).values({
            shopId: actor.shopId,
            userId: actor.userId,
            entity: "customer",
            entityId: draft.customerId,
            action: "edit",
            changedFields: changed.map((field) => AUDIT_FIELD[field]),
          });
          return { ok: true, changed };
        },
      );
    } catch (error) {
      // UNIQUE (shop_id, cccd_hash): CCCD mới đã thuộc khách khác trong cửa hàng.
      if (uniqueViolation(error) === "customers_shop_id_cccd_hash_key")
        return { ok: false, error: "duplicate_cccd" };
      throw error;
    }
  }

  async revealCccd(
    actor: Actor,
    customerId: string,
  ): Promise<{ cccd: string | null } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ encrypted: customers.cccdEncrypted })
        .from(customers)
        .where(
          and(eq(customers.shopId, actor.shopId), eq(customers.id, customerId)),
        );
      if (!row) return null;
      if (!row.encrypted) return { cccd: null };
      const cccd = this.cipher().decrypt(actor.shopId, row.encrypted);
      await tx
        .insert(auditLogs)
        .values({
          shopId: actor.shopId,
          userId: actor.userId,
          entity: "customer",
          entityId: customerId,
          action: "view_cccd",
        });
      return { cccd };
    });
  }
}
