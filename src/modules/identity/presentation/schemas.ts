import "server-only";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/composition-root";

const USERNAME_RULE = "Tên đăng nhập 3–30 ký tự, chỉ gồm chữ không dấu, số, dấu gạch dưới và dấu chấm.";

// Cùng luật với plugin username của Better Auth.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, USERNAME_RULE)
  .max(30, USERNAME_RULE)
  .regex(/^[a-zA-Z0-9_.]+$/, USERNAME_RULE);

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự.`)
  .max(128, "Mật khẩu tối đa 128 ký tự.");

export const personNameSchema = z.string().trim().min(1, "Nhập họ tên.").max(100, "Họ tên tối đa 100 ký tự.");

/** Giữ lại giá trị đã nhập (trừ mật khẩu) để form không bị xoá trắng khi báo lỗi. */
export function keepValues(formData: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}
