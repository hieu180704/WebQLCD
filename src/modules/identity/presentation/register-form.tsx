"use client";

import { useActionState } from "react";
import { FormField } from "./form-field";
import { registerAction, type RegisterState } from "./register-action";

const initialState: RegisterState = { error: null, values: {} };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);
  const v = state.values;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormField label="Tên cửa hàng" id="shopName" defaultValue={v.shopName} autoComplete="organization" required maxLength={100} autoFocus />
      <FormField label="Họ tên chủ tiệm" id="ownerName" defaultValue={v.ownerName} autoComplete="name" required maxLength={100} />
      <FormField label="Email" id="email" type="email" defaultValue={v.email} autoComplete="email" required maxLength={254} />
      <FormField label="Tên đăng nhập" id="username" defaultValue={v.username} autoComplete="username" required maxLength={30} />
      <FormField label="Mật khẩu" id="password" type="password" autoComplete="new-password" required maxLength={128} />
      <FormField label="Nhập lại mật khẩu" id="passwordConfirm" type="password" autoComplete="new-password" required maxLength={128} />
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {state.error}
      </p>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Đang tạo cửa hàng…" : "Đăng ký dùng thử 7 ngày"}
      </button>
    </form>
  );
}
