"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { reverseManualEntryAction, type ReverseEntryState } from "./actions";
import { useReportCashStatus } from "./cash-status";

const initialState: ReverseEntryState = { error: null, message: null, done: 0 };

type Target = { transactionId: string; summary: string };

const OpenReverse = createContext<(target: Target) => void>(() => {});

/**
 * Hộp thoại huỷ phiếu thu khác / chi khác / nạp vốn (chỉ chủ tiệm): ghi bút toán đảo vào hôm nay.
 * Một hộp thoại cho cả bảng, đặt ngoài các dòng: huỷ xong dòng mất nút huỷ (unmount) mà hộp thoại vẫn còn để báo kết quả.
 */
export function ReverseEntryDialog({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(reverseManualEntryAction, initialState);
  const reportStatus = useReportCashStatus();
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState("");

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open(next: Target) {
    setTarget(next);
    setReason("");
    dialog.current?.showModal();
  }

  return (
    <OpenReverse value={open}>
      {children}
      <dialog ref={dialog} aria-labelledby="reverse-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="reverse-title" className="text-lg font-semibold">
            Huỷ phiếu
          </h2>
          <p className="text-sm">{target?.summary}</p>
          <input type="hidden" name="transactionId" value={target?.transactionId ?? ""} />
          <div className="field">
            <label htmlFor="reverse-reason">
              Lý do huỷ <span className="req">*</span>
            </label>
            <input
              id="reverse-reason"
              name="reason"
              className="input"
              autoComplete="off"
              required
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500">Phiếu gốc vẫn giữ trong sổ, ghi thêm bút toán đảo vào quỹ két hôm nay.</p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Đóng
            </button>
            <button type="submit" className="btn btn-danger" disabled={pending}>
              {pending ? "Đang huỷ…" : "Huỷ phiếu"}
            </button>
          </div>
        </form>
      </dialog>
    </OpenReverse>
  );
}

/** Nút "Huỷ" trên một dòng phiếu; mở hộp thoại chung của bảng. */
export function ReverseEntryButton(target: Target) {
  const open = useContext(OpenReverse);
  return (
    <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => open(target)}>
      Huỷ
    </button>
  );
}
