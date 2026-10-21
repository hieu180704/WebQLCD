"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { payInterestAction, type ContractOperationState } from "./actions";

/** Một lựa chọn "đóng đến hết kỳ k"; tiền đã định dạng sẵn ở server (Money không qua được ranh giới client). */
export type InterestChoice = { periods: number; toText: string; amountText: string };

const initialState: ContractOperationState = { error: null, message: null, done: 0 };

export function PayInterestDialog({
  contractId,
  code,
  expectedPaidUntil,
  choices,
}: {
  contractId: string;
  code: string;
  expectedPaidUntil: string;
  choices: InterestChoice[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(payInterestAction, initialState);
  const [periods, setPeriods] = useState(1);
  const [amount, setAmount] = useState(choices[0]?.amountText ?? "");
  // Ngày trả đến đổi (vừa đóng lãi, hoặc tải lại vì trang cũ): lựa chọn cũ không còn đúng, chọn lại kỳ đầu.
  const [seenPaidUntil, setSeenPaidUntil] = useState(expectedPaidUntil);
  if (seenPaidUntil !== expectedPaidUntil) {
    setSeenPaidUntil(expectedPaidUntil);
    setPeriods(1);
    setAmount(choices[0]?.amountText ?? "");
  }

  // Đóng lãi xong thì đóng hộp thoại.
  useEffect(() => {
    if (state.done === 0) return;
    dialog.current?.close();
  }, [state.done]);

  function open() {
    setPeriods(1);
    setAmount(choices[0]?.amountText ?? "");
    dialog.current?.showModal();
  }

  function choose(value: number) {
    setPeriods(value);
    setAmount(choices.find((c) => c.periods === value)?.amountText ?? "");
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={open} disabled={choices.length === 0}>
        Đóng lãi
      </button>
      {state.message && (
        <p role="status" className="basis-full rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
          {state.message}
        </p>
      )}
      <dialog ref={dialog} aria-labelledby="pay-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="pay-title" className="text-lg font-semibold">
            Đóng lãi — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="expectedPaidUntil" value={expectedPaidUntil} />
          <div className="field">
            <label htmlFor="pay-periods">Đóng đến hết kỳ</label>
            <select id="pay-periods" name="periods" className="input" value={periods} onChange={(e) => choose(Number(e.target.value))}>
              {choices.map((c) => (
                <option key={c.periods} value={c.periods}>
                  {c.periods} kỳ (đến {c.toText}) — {c.amountText} đ
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
          <p className="text-xs text-slate-500">Quỹ két ghi một khoản thu lãi vào hôm nay. Được thu ít hơn tiền lãi (giảm lãi), không được thu nhiều hơn.</p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : "Xác nhận đóng lãi"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
