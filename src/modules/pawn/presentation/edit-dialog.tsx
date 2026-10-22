"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { editContractAction, type ContractOperationState } from "./actions";
import { useReportStatus } from "./operation-status";

const initialState: ContractOperationState = { error: null, message: null, done: 0 };

/**
 * Hộp thoại sửa thông tin hồ sơ (core-spec mục 2, "Sửa"): chỉ tên tài sản và ghi chú, không sinh giao dịch.
 * Sửa thông tin khách làm ở trang khách hàng (một khách gắn nhiều hợp đồng).
 */
export function EditDialog({
  contractId,
  code,
  secured,
  assetName,
  note,
}: {
  contractId: string;
  code: string;
  /** Cầm đồ (thế chấp) bắt buộc có tên tài sản. */
  secured: boolean;
  assetName: string | null;
  note: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(editContractAction, initialState);
  const reportStatus = useReportStatus();
  const [asset, setAsset] = useState(assetName ?? "");
  const [text, setText] = useState(note ?? "");

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open() {
    setAsset(assetName ?? "");
    setText(note ?? "");
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={open}>
        Sửa thông tin
      </button>
      <dialog ref={dialog} aria-labelledby="edit-title" className="card p-0 m-auto w-[min(92vw,480px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="edit-title" className="text-lg font-semibold">
            Sửa thông tin — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="expectedAssetName" value={assetName ?? ""} />
          <input type="hidden" name="expectedNote" value={note ?? ""} />
          <div className="field">
            <label htmlFor="edit-asset">
              Tên tài sản {secured && <span className="req">*</span>}
            </label>
            <input
              id="edit-asset"
              name="assetName"
              className="input"
              autoComplete="off"
              required={secured}
              maxLength={200}
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-note">Ghi chú</label>
            <textarea id="edit-note" name="note" className="input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">
            Sửa thông tin không sinh giao dịch, có ghi nhật ký ai sửa lúc nào. Số tiền vay, ngày vay, lãi, kỳ lãi không sửa được:
            nhập sai thì xoá hợp đồng rồi tạo lại. Số ngày vay đổi bằng gia hạn.
          </p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : "Lưu thông tin"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
