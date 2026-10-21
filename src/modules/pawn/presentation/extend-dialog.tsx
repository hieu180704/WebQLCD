"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addDays } from "@/shared/kernel/local-date";
import { formatVnd, parseVnd } from "@/shared/kernel/vnd";
import { extendContractAction, type ContractOperationState } from "./actions";
import { formatDay } from "./format";
import { useReportStatus } from "./operation-status";

const initialState: ContractOperationState = { error: null, message: null, done: 0 };

/** Hộp thoại gia hạn (mockup cam-do-chi-tiet.html): cộng số ngày vay, tuỳ chọn thu lãi đến hôm nay. */
export function ExtendDialog({
  contractId,
  code,
  expectedPaidUntil,
  asOf,
  outstanding,
  loanDate,
  termDays,
  defaultDays,
  interestDue,
  interestDays,
}: {
  contractId: string;
  code: string;
  expectedPaidUntil: string;
  asOf: string;
  outstanding: string;
  loanDate: string;
  termDays: number;
  /** Số ngày gia hạn gợi ý (bằng kỳ lãi). */
  defaultDays: number;
  /** Lãi đến hôm nay, số nguyên đồng. */
  interestDue: string;
  interestDays: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(extendContractAction, initialState);
  const reportStatus = useReportStatus();
  const due = parseVnd(interestDue)!;
  const dueText = formatVnd(due);
  const [days, setDays] = useState(String(defaultDays));
  const [collect, setCollect] = useState(due.isPositive());
  const [interest, setInterest] = useState(dueText);
  // Số liệu đổi (vừa thao tác, hoặc tải lại vì trang cũ): đặt lại lãi mặc định.
  const lock = `${expectedPaidUntil}|${termDays}|${interestDue}`;
  const [seenLock, setSeenLock] = useState(lock);
  if (seenLock !== lock) {
    setSeenLock(lock);
    setCollect(due.isPositive());
    setInterest(dueText);
  }

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần (`message` đổi về null khi lần sau lỗi thì không đóng lại hộp thoại).
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open() {
    setDays(String(defaultDays));
    setCollect(due.isPositive());
    setInterest(dueText);
    dialog.current?.showModal();
  }

  const extra = /^\d{1,4}$/.test(days.trim()) ? Number(days) : null;
  const newTerm = extra && extra > 0 ? termDays + extra : null;

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={open}>
        Gia hạn
      </button>
      <dialog ref={dialog} aria-labelledby="extend-title" className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="extend-title" className="text-lg font-semibold">
            Gia hạn — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="expectedTermDays" value={termDays} />
          <input type="hidden" name="expectedPaidUntil" value={expectedPaidUntil} />
          <input type="hidden" name="expectedOutstanding" value={outstanding} />
          <input type="hidden" name="asOf" value={asOf} />
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Hạn hiện tại</dt>
            <dd className="text-right num">
              {formatDay(addDays(loanDate, termDays))} ({termDays} ngày)
            </dd>
          </dl>
          <div className="field">
            <label htmlFor="extend-days">
              Gia hạn thêm (ngày) <span className="req">*</span>
            </label>
            <input
              id="extend-days"
              name="extraDays"
              className="input num"
              inputMode="numeric"
              autoComplete="off"
              required
              maxLength={4}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          {due.isPositive() && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="collectInterest" checked={collect} onChange={(e) => setCollect(e.target.checked)} /> Thu
                lãi đến hôm nay ({dueText} đ, {interestDays} ngày)
              </label>
              {collect && (
                <div className="field">
                  <label htmlFor="extend-interest">Tiền lãi thu (đồng)</label>
                  <input
                    id="extend-interest"
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
              )}
            </>
          )}
          <dl className="grid grid-cols-2 text-sm">
            <dt className="font-semibold border-t border-slate-200 pt-2">Hạn mới</dt>
            <dd className="text-right num font-bold border-t border-slate-200 pt-2">
              {newTerm ? `${formatDay(addDays(loanDate, newTerm))} (${newTerm} ngày)` : "—"}
            </dd>
          </dl>
          <p className="text-xs text-slate-500">
            Gia hạn không đổi tiền két. Nếu thu lãi, quỹ két ghi một khoản thu đóng lãi (được thu ít hơn, phải lớn hơn 0).
          </p>
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : "Xác nhận gia hạn"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
