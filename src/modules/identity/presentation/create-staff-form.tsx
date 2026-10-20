"use client";

import { useActionState } from "react";
import { FormField } from "./form-field";
import { createStaffAction, type CreateStaffState } from "./staff-actions";

const initialState: CreateStaffState = { error: null, created: null, values: {} };

export function CreateStaffForm() {
  const [state, formAction, pending] = useActionState(createStaffAction, initialState);
  const v = state.values;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormField label="Họ tên nhân viên" id="name" defaultValue={v.name} autoComplete="off" required maxLength={100} />
      <FormField label="Tên đăng nhập" id="username" defaultValue={v.username} autoComplete="off" required maxLength={30} />
      <FormField label="Mật khẩu" id="password" type="password" autoComplete="new-password" required maxLength={128} />
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {state.error}
      </p>
      {state.created && (
        <p role="status" className="rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
          Đã tạo nhân viên {state.created}.
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Đang tạo…" : "Tạo nhân viên"}
      </button>
    </form>
  );
}
