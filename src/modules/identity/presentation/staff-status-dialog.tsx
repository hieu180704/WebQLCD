"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setStaffActiveAction, type StaffStatusState } from "./staff-actions";

const initialState: StaffStatusState = { error: null, message: null, done: 0 };

type Target = { staffId: string; name: string; active: boolean };

const OpenStatus = createContext<(target: Target) => void>(() => {});

/**
 * Hộp thoại khoá / mở khoá KTV (chỉ chủ tiệm). Một hộp thoại cho cả bảng, đặt ngoài các dòng:
 * đổi trạng thái xong nút trên dòng đổi theo mà hộp thoại vẫn còn để báo kết quả.
 */
export function StaffStatusDialog({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(
    setStaffActiveAction,
    initialState,
  );
  const [target, setTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    setMessage(state.message);
  }, [state.done, state.message]);

  function open(next: Target) {
    setTarget(next);
    dialog.current?.showModal();
  }

  const locking = target?.active === false;

  return (
    <OpenStatus value={open}>
      {message && (
        <p
          role="status"
          className="mx-5 mb-3 rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm"
        >
          {message}
        </p>
      )}
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="staff-status-title"
        className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40"
      >
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="staff-status-title" className="text-lg font-semibold">
            {locking ? "Khoá" : "Mở khoá"} tài khoản {target?.name}?
          </h2>
          <p className="text-sm">
            {locking
              ? "Nhân viên sẽ bị đăng xuất ngay và không đăng nhập được cho tới khi mở khoá."
              : "Nhân viên đăng nhập lại được bằng mật khẩu hiện tại."}
          </p>
          <input type="hidden" name="staffId" value={target?.staffId ?? ""} />
          <input
            type="hidden"
            name="active"
            value={String(target?.active ?? false)}
          />
          <p
            role="alert"
            aria-live="polite"
            className="min-h-5 text-sm text-red-700"
          >
            {state.error}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => dialog.current?.close()}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className={`btn ${locking ? "btn-danger" : "btn-primary"}`}
              disabled={pending}
            >
              {pending ? "Đang lưu…" : locking ? "Khoá tài khoản" : "Mở khoá"}
            </button>
          </div>
        </form>
      </dialog>
    </OpenStatus>
  );
}

/** Nút "Khoá" / "Mở khoá" trên một dòng KTV; mở hộp thoại chung của bảng. `active` là trạng thái đang có. */
export function StaffStatusButton({
  staffId,
  name,
  active,
}: {
  staffId: string;
  name: string;
  active: boolean;
}) {
  const open = useContext(OpenStatus);
  return (
    <button
      type="button"
      className={`text-sm hover:underline ${active ? "text-red-700" : "text-teal-700"}`}
      aria-label={`${active ? "Khoá" : "Mở khoá"} ${name}`}
      onClick={() => open({ staffId, name, active: !active })}
    >
      {active ? "Khoá" : "Mở khoá"}
    </button>
  );
}
