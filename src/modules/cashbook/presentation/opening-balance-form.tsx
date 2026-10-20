"use client";

import { useActionState } from "react";
import { setOpeningBalanceAction, type OpeningBalanceState } from "./actions";

const initialState: OpeningBalanceState = { error: null, amount: "" };

export function OpeningBalanceForm() {
  const [state, formAction, pending] = useActionState(setOpeningBalanceAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="field">
        <label htmlFor="amount">Quỹ đầu két (đồng)</label>
        <input id="amount" name="amount" className="input num" inputMode="numeric" autoComplete="off" required maxLength={30} defaultValue={state.amount} />
      </div>
      <p className="text-xs text-slate-500">Chỉ nhập một lần, ghi vào ngày mở két. Kiểm tra kỹ trước khi lưu.</p>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {state.error}
      </p>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Đang lưu…" : "Lưu quỹ đầu két"}
      </button>
    </form>
  );
}
