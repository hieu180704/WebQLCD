"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, createStaff, requireSession, setStaffActive } from "@/composition-root";
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

export type StaffStatusState = { error: string | null; message: string | null; done: number };

const staffIdSchema = z.uuid("Không tìm thấy nhân viên.");

const STATUS_DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được khoá / mở khoá nhân viên.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không mở khoá nhân viên được.",
};

/** Khoá được cả khi cửa hàng hết hạn (thao tác bảo mật); mở khoá cần quyền ghi. */
export async function setStaffActiveAction(previous: StaffStatusState, formData: FormData): Promise<StaffStatusState> {
  const fail = (error: string): StaffStatusState => ({ ...previous, error, message: null });
  const active = formData.get("active") === "true";
  let actor;
  try {
    actor = await requireSession({ role: "owner", write: active });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(STATUS_DENIED[error.reason]);
    throw error;
  }

  const parsed = staffIdSchema.safeParse(formData.get("staffId"));
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await setStaffActive.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data, active);
  refresh();
  if (result === "not_found") return fail("Nhân viên không còn hoặc đã đổi trạng thái. Danh sách đã được tải lại.");
  return { error: null, message: active ? "Đã mở khoá nhân viên." : "Đã khoá nhân viên, mọi phiên đăng nhập của người đó bị đăng xuất.", done: previous.done + 1 };
}
