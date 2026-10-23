"use client";

import { useActionState } from "react";
import {
  changePasswordAction,
  type ChangePasswordState,
} from "./account-actions";
import { FormField } from "./form-field";

const initialState: ChangePasswordState = { error: null, done: false };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormField
        label="Mật khẩu hiện tại"
        id="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
      />
      <FormField
        label="Mật khẩu mới"
        id="newPassword"
        type="password"
        autoComplete="new-password"
        required
        maxLength={128}
      />
      <FormField
        label="Nhập lại mật khẩu mới"
        id="newPasswordConfirm"
        type="password"
        autoComplete="new-password"
        required
        maxLength={128}
      />
      <p
        role="alert"
        aria-live="polite"
        className="min-h-5 text-sm text-red-700"
      >
        {state.error}
      </p>
      {state.done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm"
        >
          Đã đổi mật khẩu. Các phiên đăng nhập khác của tài khoản này bị đăng
          xuất.
        </p>
      )}
      <button
        type="submit"
        className="btn btn-primary self-start"
        disabled={pending}
      >
        {pending ? "Đang lưu…" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
