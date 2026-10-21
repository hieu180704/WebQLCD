"use client";

import { useActionState, useRef, useState } from "react";
import { formatVnd, parseVnd } from "@/shared/kernel/vnd";
import { redeemContractAction, type ContractOperationState } from "./actions";

const initialState: ContractOperationState = { error: null, message: null, done: 0 };

/** Hộp thoại chuộc đồ / đóng hợp đồng (mockup cam-do-chi-tiet.html). Tiền truyền dạng chuỗi (Money không qua được ranh giới client). */
export function RedeemDialog({
  contractId,
  code,
  title,
  expectedPaidUntil,
  asOf,
  outstanding,
  interestDue,
  interestDays,
}: {
  contractId: string;
  code: string;
  /** "Chuộc đồ" (cầm đồ) hoặc "Đóng hợp đồng" (tín chấp). */
  title: string;
  expectedPaidUntil: string;
  asOf: string;
  /** Gốc còn lại, số nguyên đồng. */
  outstanding: string;
  /** Lãi đến hôm nay, số nguyên đồng. */
  interestDue: string;
  interestDays: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(redeemContractAction, initialState);
  const dueText = formatVnd(parseVnd(interestDue)!);
  const [interest, setInterest] = useState(dueText);
  // Số liệu đổi (tải lại vì trang cũ): đặt lại tiền lãi mặc định.
  const [seenDue, setSeenDue] = useState(interestDue);
  if (seenDue !== interestDue) {
    setSeenDue(interestDue);
    setInterest(dueText);
  }

  const principal = parseVnd(outstanding)!;
  const entered = parseVnd(interest);
  const total = entered ? formatVnd(principal.add(entered)) : "—";

  function open() {
    setInterest(dueText);
    dialog.current?.showModal();
  }

  return (
    <>
      <button type="button" className="btn btn-outline sm:ml-auto !border-teal-700 !text-teal-800" onClick={open}>
        {title}
      </button>
      <dialog ref={dialog} aria-labelledby="redeem-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="redeem-title" className="text-lg font-semibold">
            {title} — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="expectedPaidUntil" value={expectedPaidUntil} />
          <input type="hidden" name="expectedOutstanding" value={outstanding} />
          <input type="hidden" name="asOf" value={asOf} />
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Tiền gốc</dt>
            <dd className="text-right num">{formatVnd(principal)}</dd>
            <dt className="text-slate-500">Lãi đến hôm nay ({interestDays} ngày)</dt>
            <dd className="text-right num">{dueText}</dd>
          </dl>
          <div className="field">
            <label htmlFor="redeem-interest">Tiền lãi thu (đồng)</label>
            <input
              id="redeem-interest"
              name="interest"
              className="input num"
              inputMode="numeric"
              autoComplete="off"
              required
              maxLength={30}
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
            />
          </div>
          <dl className="grid grid-cols-2 text-sm">
            <dt className="font-semibold border-t border-slate-200 pt-2">Tổng cần thu</dt>
            <dd className="text-right num font-bold border-t border-slate-200 pt-2">
              {total}
            </dd>
          </dl>
          <p className="text-xs text-slate-500">
            Quỹ két ghi khoản thu lãi và trả gốc vào hôm nay, hợp đồng chuyển sang đã đóng. Được thu ít hơn tiền lãi (giảm lãi),
            không được thu nhiều hơn.
          </p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : `Xác nhận ${title.toLowerCase()}`}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
