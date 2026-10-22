"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { editCustomerAction, type EditCustomerState } from "./actions";

const initialState: EditCustomerState = { error: null, message: null, done: 0 };

type Info = {
  fullName: string;
  phone: string | null;
  address: string | null;
  cccdMasked: string | null;
};

/** Hộp thoại sửa thông tin khách (mockup khach-hang-chi-tiet.html): không sinh giao dịch, CCCD để trống thì giữ nguyên. */
export function EditCustomerDialog({
  customerId,
  info,
}: {
  customerId: string;
  info: Info;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(
    editCustomerAction,
    initialState,
  );
  const [values, setValues] = useState({
    fullName: "",
    cccd: "",
    phone: "",
    address: "",
  });
  const [message, setMessage] = useState<string | null>(null);

  // Thành công thì đóng hộp thoại, báo kết quả; mỗi lần thành công xử lý một lần.
  const handledDone = useRef(0);
  useEffect(() => {
    if (state.done === handledDone.current) return;
    handledDone.current = state.done;
    dialog.current?.close();
    setMessage(state.message);
  }, [state.done, state.message]);

  function open() {
    setValues({
      fullName: info.fullName,
      cccd: "",
      phone: info.phone ?? "",
      address: info.address ?? "",
    });
    setMessage(null);
    dialog.current?.showModal();
  }

  const bind = (name: keyof typeof values) => ({
    name,
    value: values[name],
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  return (
    <>
      {message && (
        <span role="status" className="text-sm text-emerald-700">
          {message}
        </span>
      )}
      <button type="button" className="btn btn-outline" onClick={open}>
        Sửa thông tin
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="edit-customer-title"
        className="card p-0 m-auto w-[min(92vw,480px)] backdrop:bg-slate-900/40"
      >
        <form action={formAction} className="p-5 flex flex-col gap-4">
          <h2 id="edit-customer-title" className="text-lg font-semibold">
            Sửa thông tin khách
          </h2>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="expectedFullName" value={info.fullName} />
          <input type="hidden" name="expectedPhone" value={info.phone ?? ""} />
          <input
            type="hidden"
            name="expectedAddress"
            value={info.address ?? ""}
          />
          <input
            type="hidden"
            name="expectedCccdMasked"
            value={info.cccdMasked ?? ""}
          />
          <div className="field">
            <label htmlFor="k-name">
              Tên khách hàng <span className="req">*</span>
            </label>
            <input
              id="k-name"
              className="input"
              autoComplete="off"
              required
              maxLength={100}
              {...bind("fullName")}
            />
          </div>
          <div className="field">
            <label htmlFor="k-cccd">Số CCCD</label>
            <input
              id="k-cccd"
              className="input num"
              inputMode="numeric"
              autoComplete="off"
              maxLength={30}
              placeholder={
                info.cccdMasked
                  ? `Để trống nếu không đổi (${info.cccdMasked})`
                  : "Chưa có, để trống nếu không thêm"
              }
              {...bind("cccd")}
            />
          </div>
          <div className="field">
            <label htmlFor="k-phone">Số điện thoại</label>
            <input
              id="k-phone"
              className="input num"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
              {...bind("phone")}
            />
          </div>
          <div className="field">
            <label htmlFor="k-addr">Địa chỉ</label>
            <input
              id="k-addr"
              className="input"
              autoComplete="off"
              maxLength={255}
              {...bind("address")}
            />
          </div>
          <p className="text-xs text-slate-500">
            Sửa thông tin không sinh giao dịch, có ghi nhật ký ai sửa lúc nào.
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
              {pending ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
