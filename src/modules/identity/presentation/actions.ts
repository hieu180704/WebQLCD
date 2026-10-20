"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/composition-root";
import type { SignInResult } from "../application/ports";

export type SignInState = { error: string | null };

// Cùng luật với plugin username của Better Auth; sai định dạng thì báo chung như sai mật khẩu.
const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  password: z.string().min(1).max(128),
});

const MESSAGES: Record<Exclude<SignInResult, "ok">, string> = {
  invalid_credentials: "Sai tên đăng nhập hoặc mật khẩu.",
  locked: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  inactive: "Tài khoản đã bị vô hiệu hoá. Vui lòng liên hệ chủ tiệm.",
};

export async function signInAction(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: MESSAGES.invalid_credentials };

  const result = await signIn.execute(parsed.data);
  if (result !== "ok") return { error: MESSAGES[result] };
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await signOut.execute();
  redirect("/dang-nhap");
}
