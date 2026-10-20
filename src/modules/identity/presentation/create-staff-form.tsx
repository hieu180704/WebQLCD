"use client";

import { useActionState } from "react";
import { Button } from "@/shared/ui/button";
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
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
        {state.error}
      </p>
      {state.created && (
        <p role="status" className="text-sm">
          Đã tạo nhân viên {state.created}.
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Đang tạo…" : "Tạo nhân viên"}
      </Button>
    </form>
  );
}
