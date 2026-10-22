import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/shared/infrastructure/db/client";
import { auditLogs, customers } from "@/shared/infrastructure/db/schema";
import type { NewCustomer, ResolvedCustomer } from "../domain/customer";
import { cccdColumns, type CccdCipher } from "./cccd-cipher";

type Actor = { userId: string; shopId: string };

/**
 * Ghi khách trong transaction của thao tác gọi tới (vd. tạo hợp đồng). Có CCCD trùng trong cửa hàng thì dùng lại
 * khách cũ và KHÔNG ghi đè thông tin (đổi thông tin khách là thao tác "Sửa" riêng); không có CCCD thì luôn tạo mới.
 */
export class DrizzleCustomerWriter {
  /** Khoá CCCD lấy lười: thiếu khoá chỉ chặn thao tác có CCCD, không làm hỏng cả ứng dụng. */
  constructor(private readonly cipher: () => CccdCipher) {}

  async resolve(tx: Tx, actor: Actor, input: NewCustomer): Promise<ResolvedCustomer> {
    const protectedCccd = input.cccd ? cccdColumns(this.cipher(), actor.shopId, input.cccd) : null;
    const [created] = await tx
      .insert(customers)
      .values({
        shopId: actor.shopId,
        fullName: input.fullName,
        phone: input.phone,
        address: input.address,
        ...protectedCccd,
      })
      // Khớp partial unique index (shop_id, cccd_hash) WHERE cccd_hash IS NOT NULL; hai yêu cầu đồng thời cùng
      // CCCD thì một bên chèn, bên kia đọc lại dòng đã có.
      .onConflictDoNothing({ target: [customers.shopId, customers.cccdHash], where: sql`${customers.cccdHash} IS NOT NULL` })
      .returning({ id: customers.id, fullName: customers.fullName });

    if (created) {
      await tx.insert(auditLogs).values({ shopId: actor.shopId, userId: actor.userId, entity: "customer", entityId: created.id, action: "create" });
      return { ...created, reused: false };
    }
    if (!protectedCccd) throw new Error("Không chèn được khách hàng");
    const [existing] = await tx
      .select({ id: customers.id, fullName: customers.fullName })
      .from(customers)
      .where(and(eq(customers.shopId, actor.shopId), eq(customers.cccdHash, protectedCccd.cccdHash)));
    if (!existing) throw new Error("Không tìm thấy khách hàng trùng CCCD");
    return { ...existing, reused: true };
  }
}
