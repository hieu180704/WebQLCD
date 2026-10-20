"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";
import { FormField } from "./form-field";

const initialState: SignInState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormField label="Tên đăng nhập" id="username" autoComplete="username" required maxLength={30} autoFocus />
      <FormField label="Mật khẩu" id="password" type="password" autoComplete="current-password" required maxLength={128} />
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {state.error}
      </p>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
