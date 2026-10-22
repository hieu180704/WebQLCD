"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ManualEntryType } from "../application/ports";
import { recordManualEntryAction, type ManualEntryState } from "./actions";

const initialState: ManualEntryState = { error: null, message: null, done: 0, amount: "", note: "" };

type EntryKind = { type: ManualEntryType; button: string; title: string; submit: string; noteLabel: string; noteRequired: boolean; hint: string };

const KINDS: EntryKind[] = [
  { type: "manual_income", button: "+ Thu khác", title: "Phiếu thu khác", submit: "Lưu phiếu thu", noteLabel: "Nội dung", noteRequired: true, hint: "" },
  { type: "manual_expense", button: "− Chi khác", title: "Phiếu chi khác", submit: "Lưu phiếu chi", noteLabel: "Nội dung", noteRequired: true, hint: " Két được phép âm." },
  {
    type: "capital_in",
    button: "Nạp vốn",
    title: "Nạp vốn vào két",
    submit: "Nạp vốn",
    noteLabel: "Ghi chú",
    noteRequired: false,
    hint: " Dùng khi chủ tiệm bỏ thêm tiền vào két, hoặc để chỉnh lại quỹ đầu két đã nhập sai.",
  },
];

/** Nút + hộp thoại phiếu thu khác, chi khác, nạp vốn (mockup quy-ket); nạp vốn chỉ hiện với chủ tiệm. */
export function ManualEntryDialogs({ today, userName, isOwner }: { today: string; userName: string; isOwner: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {KINDS.filter((kind) => isOwner || kind.type !== "capital_in").map((kind) => (
          <EntryDialog key={kind.type} kind={kind} today={today} userName={userName} onDone={setMessage} />
        ))}
      </div>
      {message && (
        <p role="status" className="basis-full rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
          {message}
        </p>
      )}
    </>
  );
}

function EntryDialog({ kind, today, userName, onDone }: { kind: EntryKind; today: string; userName: string; onDone: (message: string | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(recordManualEntryAction, initialState);
  const titleId = `${kind.type}-title`;

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    onDone(state.message);
  }, [state.done, state.message, onDone]);

  return (
    <>
      <button type="button" className={kind.type === "capital_in" ? "btn btn-outline" : "btn btn-primary"} onClick={() => dialog.current?.showModal()}>
        {kind.button}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {kind.title}
          </h2>
          <input type="hidden" name="type" value={kind.type} />
          <div className="field">
            <label htmlFor={`${kind.type}-amount`}>
              Số tiền <span className="req">*</span>
            </label>
            <input id={`${kind.type}-amount`} name="amount" className="input num" inputMode="numeric" autoComplete="off" required maxLength={30} defaultValue={state.amount} />
          </div>
          <div className="field">
            <label htmlFor={`${kind.type}-note`}>
              {kind.noteLabel} {kind.noteRequired && <span className="req">*</span>}
            </label>
            <input id={`${kind.type}-note`} name="note" className="input" autoComplete="off" required={kind.noteRequired} maxLength={200} defaultValue={state.note} />
          </div>
          <p className="text-xs text-slate-500">
            Ghi vào quỹ két hôm nay ({today}), người thực hiện: {userName}.{kind.hint}
          </p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : kind.submit}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
