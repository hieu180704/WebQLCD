"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { reverseInstallmentAction, type InstallmentOperationState } from "./actions";
import { useReportStatus } from "./operation-status";

const initialState: InstallmentOperationState = { error: null, message: null, done: 0 };

/** Hộp thoại huỷ thao tác mới nhất (mockup tra-gop-chi-tiet.html, chỉ chủ tiệm). Chữ đã soạn sẵn ở server. */
export function ReverseDialog({
  contractId,
  operationId,
  label,
  when,
  amountText,
  effect,
}: {
  contractId: string;
  operationId: string;
  /** Tên thao tác, vd. "Đóng tiền góp", "Đóng hợp đồng". */
  label: string;
  /** "dd/mm/yyyy hh:mm · Người thực hiện". */
  when: string;
  /** Tiền vào/ra két của thao tác, có dấu; null khi không có dòng sổ két. */
  amountText: string | null;
  /** Hệ quả khi huỷ. */
  effect: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(reverseInstallmentAction, initialState);
  const reportStatus = useReportStatus();
  const [reason, setReason] = useState("");

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open() {
    setReason("");
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" className="text-sm text-red-700 hover:underline" onClick={open} title="Chỉ chủ tiệm">
        Huỷ giao dịch gần nhất
      </button>
      <dialog ref={dialog} aria-labelledby="reverse-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="reverse-title" className="text-lg font-semibold">
            Huỷ giao dịch
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="operationId" value={operationId} />
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Giao dịch</dt>
            <dd>{label}</dd>
            <dt className="text-slate-500">Thời gian</dt>
            <dd className="num">{when}</dd>
            {amountText && (
              <>
                <dt className="text-slate-500">Số tiền</dt>
                <dd className="num font-medium">{amountText}</dd>
              </>
            )}
          </dl>
          <div className="field">
            <label htmlFor="reverse-reason">
              Lý do huỷ <span className="req">*</span>
            </label>
            <input
              id="reverse-reason"
              name="reason"
              className="input"
              placeholder="VD: nhập nhầm hợp đồng"
              autoComplete="off"
              required
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500">
            Giao dịch gốc vẫn giữ trong lịch sử. {effect} Chỉ huỷ được giao dịch mới nhất; muốn huỷ giao dịch cũ hơn thì huỷ lần lượt từ mới
            về cũ.
          </p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Đóng
            </button>
            <button type="submit" className="btn btn-danger" disabled={pending}>
              {pending ? "Đang lưu…" : "Huỷ giao dịch"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
