"use client";

import { useActionState } from "react";
import type { ShopInfo } from "../application/shop-info";
import { updateShopInfoAction, type ShopFormState } from "./settings-actions";

const initialState: ShopFormState = { error: null, message: null, values: null, version: 0 };

/** Mục "Thông tin cửa hàng" (mockup cai-dat.html); `openedAt` đã định dạng dd/mm/yyyy, chỉ đọc. */
export function ShopInfoForm({ info, openedAt }: { info: ShopInfo; openedAt: string }) {
  const [state, formAction, pending] = useActionState(updateShopInfoAction, initialState);
  const v = state.values ?? { name: info.name, phone: info.phone ?? "", address: info.address ?? "" };

  return (
    <form action={formAction} className="mt-4 grid sm:grid-cols-2 gap-4">
      <div className="field sm:col-span-2">
        <label htmlFor="shop-name">
          Tên cửa hàng <span className="req">*</span>
        </label>
        <input id="shop-name" name="name" className="input" defaultValue={v.name} required maxLength={100} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="shop-phone">Số điện thoại</label>
        <input id="shop-phone" name="phone" className="input" defaultValue={v.phone} inputMode="tel" maxLength={30} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="shop-opened">Ngày mở két</label>
        <input id="shop-opened" className="input bg-slate-50" value={openedAt} readOnly />
      </div>
      <div className="field sm:col-span-2">
        <label htmlFor="shop-address">Địa chỉ</label>
        <input id="shop-address" name="address" className="input" defaultValue={v.address} maxLength={255} autoComplete="off" />
      </div>
      <p role="alert" aria-live="polite" className="sm:col-span-2 min-h-5 text-sm text-red-700">
        {state.error}
      </p>
      {state.message && (
        <p role="status" className="sm:col-span-2 rounded-lg bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Đang lưu…" : "Lưu thông tin"}
        </button>
      </div>
    </form>
  );
}
