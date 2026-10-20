"use client";

import { useActionState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { setOpeningBalanceAction, type OpeningBalanceState } from "./actions";

const initialState: OpeningBalanceState = { error: null, amount: "" };

export function OpeningBalanceForm() {
  const [state, formAction, pending] = useActionState(setOpeningBalanceAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="amount">Quỹ đầu két (đồng)</Label>
        <Input id="amount" name="amount" inputMode="numeric" autoComplete="off" required maxLength={30} defaultValue={state.amount} />
      </div>
      <p className="text-xs text-muted-foreground">Chỉ nhập một lần, ghi vào ngày mở két. Kiểm tra kỹ trước khi lưu.</p>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
        {state.error}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Đang lưu…" : "Lưu quỹ đầu két"}
      </Button>
    </form>
  );
}
