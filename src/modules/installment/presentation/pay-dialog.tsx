"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { payInstallmentAction, type InstallmentOperationState } from "./actions";
import { useReportStatus } from "./operation-status";

/** Một lựa chọn "góp đến hết kỳ k"; tiền đã định dạng sẵn ở server (Money không qua được ranh giới client). */
export type PaymentChoice = { index: number; dueText: string; amountText: string };

const initialState: InstallmentOperationState = { error: null, message: null, done: 0 };

/** Hộp thoại đóng tiền góp (mockup tra-gop-chi-tiet.html). Ô kỳ chỉ gợi ý số tiền; khách đưa lẻ thì phần dư dồn sang kỳ sau. */
export function PayDialog({
  contractId,
  code,
  expectedPaid,
  choices,
}: {
  contractId: string;
  code: string;
  /** Số đã thu lúc tải trang (khoá lạc quan), dạng chuỗi số nguyên. */
  expectedPaid: string;
  choices: PaymentChoice[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(payInstallmentAction, initialState);
  const reportStatus = useReportStatus();
  const first = choices[0];
  const [index, setIndex] = useState(first?.index ?? 0);
  const [amount, setAmount] = useState(first?.amountText ?? "");
  // Số đã thu đổi (vừa thu, hoặc tải lại vì trang cũ): lựa chọn cũ không còn đúng, chọn lại kỳ tới.
  const [seenPaid, setSeenPaid] = useState(expectedPaid);
  if (seenPaid !== expectedPaid) {
    setSeenPaid(expectedPaid);
    setIndex(first?.index ?? 0);
    setAmount(first?.amountText ?? "");
  }

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open() {
    setIndex(first?.index ?? 0);
    setAmount(first?.amountText ?? "");
    dialog.current?.showModal();
  }

  function choose(value: number) {
    setIndex(value);
    setAmount(choices.find((c) => c.index === value)?.amountText ?? "");
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={open} disabled={choices.length === 0}>
        Đóng tiền góp
      </button>
      <dialog ref={dialog} aria-labelledby="pay-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="pay-title" className="text-lg font-semibold">
            Đóng tiền góp — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="expectedPaid" value={expectedPaid} />
          <div className="field">
            <label htmlFor="pay-period">Góp đến hết kỳ</label>
            <select id="pay-period" className="input" value={index} onChange={(e) => choose(Number(e.target.value))}>
              {choices.map((c) => (
                <option key={c.index} value={c.index}>
                  Kỳ {c.index} ({c.dueText}) — {c.amountText} đ
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pay-amount">Số tiền khách đưa (đồng)</label>
            <input
              id="pay-amount"
              name="amount"
              className="input num"
              inputMode="numeric"
              autoComplete="off"
              required
              maxLength={30}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500">
            Khách đưa lẻ (không tròn kỳ) thì phần dư được tính vào kỳ kế tiếp. Quỹ két ghi một khoản thu vào hôm nay.
          </p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : "Xác nhận"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
