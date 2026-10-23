"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { closeInstallmentAction, type InstallmentOperationState } from "./actions";
import { useReportStatus } from "./operation-status";

const initialState: InstallmentOperationState = { error: null, message: null, done: 0 };

/** Hộp thoại đóng / tất toán (mockup tra-gop-chi-tiet.html). Tiền đã định dạng sẵn ở server. */
export function CloseDialog({
  contractId,
  code,
  expectedPaid,
  totalDueText,
  paidText,
  remainingText,
}: {
  contractId: string;
  code: string;
  /** Số đã thu lúc tải trang (khoá lạc quan), dạng chuỗi số nguyên. */
  expectedPaid: string;
  totalDueText: string;
  paidText: string;
  remainingText: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(closeInstallmentAction, initialState);
  const reportStatus = useReportStatus();
  const [amount, setAmount] = useState(remainingText);

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open() {
    setAmount(remainingText);
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" className="btn btn-outline sm:ml-auto !border-teal-700 !text-teal-800" onClick={open}>
        Đóng hợp đồng
      </button>
      <dialog ref={dialog} aria-labelledby="close-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="close-title" className="text-lg font-semibold">
            Đóng hợp đồng — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="expectedPaid" value={expectedPaid} />
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Tổng phải thu</dt>
            <dd className="text-right num">{totalDueText}</dd>
            <dt className="text-slate-500">Đã thu</dt>
            <dd className="text-right num">{paidText}</dd>
            <dt className="font-semibold border-t border-slate-200 pt-2">Còn phải thu</dt>
            <dd className="text-right num font-bold border-t border-slate-200 pt-2">{remainingText}</dd>
          </dl>
          <div className="field">
            <label htmlFor="close-amount">Số tiền thu để tất toán (đồng)</label>
            <input
              id="close-amount"
              name="amount"
              className="input num"
              inputMode="numeric"
              autoComplete="off"
              required
              maxLength={30}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="text-xs text-slate-500">Được nhập thấp hơn nếu tiệm giảm cho khách tất toán sớm.</span>
          </div>
          <p className="text-xs text-slate-500">Sau khi xác nhận: hợp đồng chuyển sang &quot;Đã đóng&quot;, quỹ két ghi khoản thu.</p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : "Xác nhận đóng"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
