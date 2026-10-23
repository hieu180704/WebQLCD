"use server";

import { z } from "zod";
import { changeOwnPassword, requireCurrentSession } from "@/composition-root";
import { newPasswordSchema } from "./schemas";

export type ChangePasswordState = { error: string | null; done: boolean };

const changeSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Nhập mật khẩu hiện tại.")
      .max(128, "Sai mật khẩu hiện tại."),
    newPassword: newPasswordSchema,
    newPasswordConfirm: z.string(),
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    message: "Mật khẩu nhập lại không khớp.",
    path: ["newPasswordConfirm"],
  });

const MESSAGES = {
  wrong_password: "Sai mật khẩu hiện tại.",
  locked: "Nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.",
} as const;

/** Mọi vai trò, cả khi cửa hàng hết hạn. Không giữ lại giá trị đã nhập: form chỉ có mật khẩu. */
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const actor = await requireCurrentSession();
  const parsed = changeSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordConfirm: formData.get("newPasswordConfirm"),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0].message, done: false };

  const result = await changeOwnPassword.execute(
    { userId: actor.userId, shopId: actor.shopId },
    actor.sessionId,
    parsed.data,
  );
  if (result !== "ok") return { error: MESSAGES[result], done: false };
  return { error: null, done: true };
}
