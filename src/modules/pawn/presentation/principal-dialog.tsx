"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Money } from "@/shared/kernel/money";
import { formatVnd, parseVnd } from "@/shared/kernel/vnd";
import { previewAdditionalLoanInterest, type InterestType } from "../application/preview";
import { changePrincipalAction, type ContractOperationState } from "./actions";
import { useReportStatus } from "./operation-status";

const initialState: ContractOperationState = { error: null, message: null, done: 0 };

const COPY = {
  repayment: { title: "Trả bớt gốc", amountLabel: "Số tiền trả bớt gốc", afterLabel: "Gốc sau khi trả", submit: "Xác nhận trả gốc" },
  additional_loan: { title: "Vay thêm", amountLabel: "Số tiền vay thêm", afterLabel: "Gốc sau khi vay thêm", submit: "Xác nhận giải ngân" },
} as const;

/**
 * Hộp thoại trả bớt gốc / vay thêm (mockup cam-do-chi-tiet.html). Lãi thu kèm theo `planPrincipalRepayment` /
 * `planAdditionalLoan`; số hiển thị chỉ để xem trước, server tính lại. Tiền truyền dạng chuỗi số nguyên đồng.
 */
export function PrincipalDialog({
  direction,
  contractId,
  code,
  expectedPaidUntil,
  asOf,
  outstanding,
  interestDue,
  interestDays,
  aheadDays,
  interestType,
  rate,
}: {
  direction: keyof typeof COPY;
  contractId: string;
  code: string;
  expectedPaidUntil: string;
  asOf: string;
  outstanding: string;
  /** Lãi đến hôm nay trên gốc còn lại. */
  interestDue: string;
  interestDays: number;
  /** Số ngày lãi đã trả vượt hôm nay; vay thêm thì thu lãi bổ sung trên phần vay thêm cho chừng ấy ngày. */
  aheadDays: number;
  interestType: InterestType;
  /** Lãi suất đã nhân RATE_SCALE. */
  rate: string;
}) {
  const copy = COPY[direction];
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(changePrincipalAction, initialState);
  const reportStatus = useReportStatus();
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");

  const principal = parseVnd(outstanding)!;
  const entered = parseVnd(amount);
  const supplementary = direction === "additional_loan" && aheadDays > 0;
  /** Lãi tính được với số tiền đang nhập; null = không có lãi để thu (ẩn ô lãi). */
  function dueFor(text: string): Money | null {
    if (supplementary) {
      const value = parseVnd(text);
      const extra = value
        ? previewAdditionalLoanInterest({ amount: value, interestType, rate: BigInt(rate), days: aheadDays })
        : Money.ZERO;
      return extra.isZero() ? null : extra;
    }
    const due = parseVnd(interestDue)!;
    return due.isZero() ? null : due;
  }
  const due = dueFor(amount);
  // Số liệu đổi (vừa thao tác, hoặc tải lại vì trang cũ): đặt lại tiền lãi mặc định.
  const lock = `${expectedPaidUntil}|${outstanding}|${interestDue}`;
  const [seenLock, setSeenLock] = useState(lock);
  if (seenLock !== lock) {
    setSeenLock(lock);
    setInterest(formatDueText(due));
  }
  const enteredInterest = parseVnd(interest) ?? Money.ZERO;

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần (`message` đổi về null khi lần sau lỗi thì không đóng lại hộp thoại).
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open() {
    setAmount("");
    setInterest(supplementary ? "" : formatDueText(dueFor("")));
    dialog.current?.showModal();
  }

  function changeAmount(text: string) {
    setAmount(text);
    // Lãi bổ sung phụ thuộc số tiền vay thêm: tính lại mặc định theo số mới.
    if (supplementary) setInterest(formatDueText(dueFor(text)));
  }

  const after = entered ? (direction === "repayment" ? principal.subtract(entered) : principal.add(entered)) : null;
  const cash = entered
    ? direction === "repayment"
      ? `Quỹ két ghi khoản thu ${formatVnd(entered.add(enteredInterest))} đ (gốc${due ? " + lãi" : ""}).`
      : `Quỹ két ghi khoản chi ${formatVnd(entered)} đ${due ? `, thu ${formatVnd(enteredInterest)} đ tiền lãi; giao khách ${formatVnd(entered.subtract(enteredInterest))} đ` : ""}.`
    : null;
  const titleId = `principal-${direction}-title`;

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={open}>
        {copy.title}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40">
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {copy.title} — {code}
          </h2>
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="expectedPaidUntil" value={expectedPaidUntil} />
          <input type="hidden" name="expectedOutstanding" value={outstanding} />
          <input type="hidden" name="asOf" value={asOf} />
          {!supplementary && due && (
            <p className="text-sm rounded-lg bg-amber-50 text-amber-800 p-3">
              Lãi đến hôm nay {formatVnd(due)} đ ({interestDays} ngày) thu kèm, để lãi từ hôm nay tính trên gốc mới.
            </p>
          )}
          {supplementary && (
            <p className="text-sm rounded-lg bg-amber-50 text-amber-800 p-3">
              Lãi đã trả thêm {aheadDays} ngày tới sau hôm nay. Phần vay thêm thu lãi bổ sung cho {aheadDays} ngày này.
            </p>
          )}
          <div className="field">
            <label htmlFor={`${titleId}-amount`}>
              {copy.amountLabel} <span className="req">*</span>
            </label>
            <input
              id={`${titleId}-amount`}
              name="amount"
              className="input num"
              inputMode="numeric"
              autoComplete="off"
              required
              maxLength={30}
              value={amount}
              onChange={(e) => changeAmount(e.target.value)}
            />
          </div>
          {due && (
            <div className="field">
              <label htmlFor={`${titleId}-interest`}>Tiền lãi thu kèm (đồng)</label>
              <input
                id={`${titleId}-interest`}
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
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Gốc hiện tại</dt>
            <dd className="text-right num">{formatVnd(principal)}</dd>
            <dt className="font-semibold border-t border-slate-200 pt-2">{copy.afterLabel}</dt>
            <dd className="text-right num font-bold border-t border-slate-200 pt-2">{after ? formatVnd(after) : "—"}</dd>
          </dl>
          {cash && <p className="text-xs text-slate-500">{cash}</p>}
          {due && <p className="text-xs text-slate-500">Được thu ít hơn tiền lãi (giảm lãi) nhưng phải lớn hơn 0.</p>}
          <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-outline" onClick={() => dialog.current?.close()}>
              Huỷ
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Đang lưu…" : copy.submit}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

const formatDueText = (due: Money | null) => (due ? formatVnd(due) : "");
