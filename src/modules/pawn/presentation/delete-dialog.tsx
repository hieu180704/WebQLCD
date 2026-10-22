"use client";

import { useActionState, useRef, useState } from "react";
import { deleteContractAction, type ContractOperationState } from "./actions";

const initialState: ContractOperationState = { error: null, message: null, done: 0 };

/** Hộp thoại xoá hợp đồng (mockup cam-do-chi-tiet.html, chỉ chủ tiệm): nhập lý do, gõ lại mã hợp đồng. */
export function DeleteDialog({
  contractId,
  code,
  cashChangeText,
}: {
  contractId: string;
  code: string;
  /** Quỹ két thay đổi khi đảo mọi giao dịch, có dấu, đã định dạng ở server. */
  cashChangeText: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(deleteContractAction, initialState);
  const [reason, setReason] = useState("");
  const [confirmCode, setConfirmCode] = useState("");

  function open() {
    setReason("");
    setConfirmCode("");
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" className="btn btn-danger" onClick={open} title="Chỉ chủ tiệm">
        Xoá
      </button>
      <dialog ref={dialog} aria-labelledby="delete-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="delete-title" className="text-lg font-semibold text-red-700">
            Xoá hợp đồng {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <p className="text-sm">
            Hợp đồng chuyển sang &quot;Đã xoá&quot;, vẫn tra cứu được. Mọi giao dịch chưa huỷ của hợp đồng được ghi bút toán đảo vào
            quỹ két hôm nay.
          </p>
          <dl className="grid grid-cols-2 text-sm">
            <dt className="font-semibold">Quỹ két thay đổi</dt>
            <dd className="text-right num font-bold">{cashChangeText}</dd>
          </dl>
          <div className="field">
            <label htmlFor="delete-reason">
              Lý do xoá <span className="req">*</span>
            </label>
            <input
              id="delete-reason"
              name="reason"
              className="input"
              autoComplete="off"
              required
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="delete-confirm">Gõ mã hợp đồng để xác nhận</label>
            <input
              id="delete-confirm"
              name="confirmCode"
              className="input"
              placeholder={code}
              autoComplete="off"
              required
              maxLength={30}
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
            />
          </div>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Đóng
            </button>
            <button type="submit" className="btn btn-danger" disabled={pending}>
              {pending ? "Đang lưu…" : "Xoá hợp đồng"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
