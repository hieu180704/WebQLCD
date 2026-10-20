"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, createStaff, requireSession } from "@/composition-root";
import { keepValues, newPasswordSchema, personNameSchema, usernameSchema } from "./schemas";

export type CreateStaffState = { error: string | null; created: string | null; values: Record<string, string> };

const KEPT_FIELDS = ["name", "username"] as const;

const staffSchema = z.object({ name: personNameSchema, username: usernameSchema, password: newPasswordSchema });

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được tạo nhân viên.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không tạo thêm nhân viên được.",
};

export async function createStaffAction(_previous: CreateStaffState, formData: FormData): Promise<CreateStaffState> {
  const values = keepValues(formData, KEPT_FIELDS);
  let actor;
  try {
    actor = await requireSession({ role: "owner", write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return { error: DENIED[error.reason], created: null, values };
    throw error;
  }

  const parsed = staffSchema.safeParse({ ...values, password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, created: null, values };

  const result = await createStaff.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (result === "username_taken") return { error: "Tên đăng nhập đã có người dùng.", created: null, values };
  refresh(); // Danh sách KTV trên trang hiện tại cập nhật ngay trong cùng response.
  return { error: null, created: parsed.data.username, values: {} };
}
