"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { registerOwner } from "@/composition-root";
import type { RegisterOwnerResult } from "../application/ports";
import { keepValues, newPasswordSchema, personNameSchema, usernameSchema } from "./schemas";

export type RegisterState = { error: string | null; values: Record<string, string> };

const KEPT_FIELDS = ["shopName", "ownerName", "email", "username"] as const;

const registrationSchema = z
  .object({
    shopName: z.string().trim().min(1, "Nhập tên cửa hàng.").max(100, "Tên cửa hàng tối đa 100 ký tự."),
    ownerName: personNameSchema,
    email: z.string().trim().toLowerCase().max(254, "Email quá dài.").pipe(z.email("Email không hợp lệ.")),
    username: usernameSchema,
    password: newPasswordSchema,
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, { message: "Mật khẩu nhập lại không khớp.", path: ["passwordConfirm"] });

const MESSAGES: Record<Exclude<RegisterOwnerResult, "ok">, string> = {
  rate_limited: "Đăng ký quá nhiều lần từ mạng này. Vui lòng thử lại sau 1 giờ.",
  username_taken: "Tên đăng nhập đã có người dùng.",
  email_taken: "Email đã được dùng để đăng ký.",
};

export async function registerAction(_previous: RegisterState, formData: FormData): Promise<RegisterState> {
  const values = keepValues(formData, KEPT_FIELDS);
  const parsed = registrationSchema.safeParse({ ...values, password: formData.get("password"), passwordConfirm: formData.get("passwordConfirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const { shopName, ownerName, email, username, password } = parsed.data;
  const result = await registerOwner.execute({ shopName, ownerName, email, username, password });
  if (result !== "ok") return { error: MESSAGES[result], values };
  redirect("/");
}
