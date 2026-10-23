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
import {
  resetStaffPasswordAction,
  type StaffStatusState,
} from "./staff-actions";
import { useReportStaffStatus } from "./staff-status-dialog";

const initialState: StaffStatusState = { error: null, message: null, done: 0 };

type Target = { staffId: string; name: string };

const OpenReset = createContext<(target: Target) => void>(() => {});

/** Hộp thoại chủ tiệm đặt lại mật khẩu KTV; đặt trong `StaffStatusDialog` để dùng chung dòng thông báo. */
export function ResetPasswordDialog({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    resetStaffPasswordAction,
    initialState,
  );
  const reportStatus = useReportStaffStatus();
  const [target, setTarget] = useState<Target | null>(null);

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    reportStatus(state.message);
  }, [state.done, state.message, reportStatus]);

  function open(next: Target) {
    setTarget(next);
    form.current?.reset(); // Không để lại mật khẩu đã gõ cho KTV trước.
    dialog.current?.showModal();
  }

  return (
    <OpenReset value={open}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="reset-title"
        className="card p-0 m-auto w-[min(92vw,440px)] backdrop:bg-slate-900/40"
      >
        <form
          ref={form}
          action={formAction}
          className="p-5 flex flex-col gap-4"
        >
          <h2 id="reset-title" className="text-lg font-semibold">
            Đặt lại mật khẩu — {target?.name}
          </h2>
          <input type="hidden" name="staffId" value={target?.staffId ?? ""} />
          <div className="field">
            <label htmlFor="reset-password">
              Mật khẩu mới <span className="req">*</span>
            </label>
            <input
              id="reset-password"
              name="password"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              maxLength={128}
            />
          </div>
          <p className="text-xs text-slate-500">
            Mọi phiên đăng nhập hiện tại của nhân viên này bị đăng xuất.
          </p>
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
              className="btn btn-primary"
              disabled={pending}
            >
              {pending ? "Đang lưu…" : "Đặt lại"}
            </button>
          </div>
        </form>
      </dialog>
    </OpenReset>
  );
}

/** Nút "Đặt lại mật khẩu" trên một dòng KTV; mở hộp thoại chung của bảng. */
export function ResetPasswordButton(target: Target) {
  const open = useContext(OpenReset);
  return (
    <button
      type="button"
      className="text-sm text-teal-700 hover:underline"
      aria-label={`Đặt lại mật khẩu ${target.name}`}
      onClick={() => open(target)}
    >
      Đặt lại mật khẩu
    </button>
  );
}
