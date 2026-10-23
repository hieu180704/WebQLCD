"use client";

import { useActionState } from "react";
import type { ContractDefaults } from "../application/contract-defaults";
import { updateContractDefaultsAction, type ShopFormState } from "./settings-actions";

const initialState: ShopFormState = { error: null, message: null, values: null, version: 0 };

/** Mục "Mặc định khi tạo hợp đồng" (mockup cai-dat.html). `interestTypes` truyền từ server (danh sách của module pawn). */
export function ContractDefaultsForm({
  defaults,
  interestTypes,
}: {
  defaults: ContractDefaults;
  interestTypes: { value: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(updateContractDefaultsAction, initialState);
  const v = state.values ?? {
    interestType: defaults.interestType,
    interestRate: defaults.interestRate?.replace(".", ",") ?? "",
    termDays: String(defaults.termDays),
    interestPeriodDays: String(defaults.interestPeriodDays),
    prepaidInterest: defaults.prepaidInterest ? "on" : "",
  };

  return (
    <form key={state.version} action={formAction} className="mt-4 grid sm:grid-cols-2 gap-4">
      <div className="field">
        <label htmlFor="d-interestType">Hình thức lãi</label>
        <select id="d-interestType" name="interestType" defaultValue={v.interestType} className="input">
          {interestTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="d-interestRate">Lãi</label>
        <input
          id="d-interestRate"
          name="interestRate"
          className="input num"
          defaultValue={v.interestRate}
          inputMode="decimal"
          maxLength={20}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="d-termDays">Số ngày vay</label>
        <input id="d-termDays" name="termDays" type="number" min={1} max={3650} className="input num" defaultValue={v.termDays} required />
      </div>
      <div className="field">
        <label htmlFor="d-interestPeriodDays">Kỳ lãi (ngày)</label>
        <input
          id="d-interestPeriodDays"
          name="interestPeriodDays"
          type="number"
          min={1}
          max={3650}
          className="input num"
          defaultValue={v.interestPeriodDays}
          required
        />
      </div>
      <label className="sm:col-span-2 flex items-center gap-2 text-sm">
        <input type="checkbox" name="prepaidInterest" defaultChecked={v.prepaidInterest === "on"} />
        Mặc định bật &quot;Thu lãi trước&quot;
      </label>
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
          {pending ? "Đang lưu…" : "Lưu mặc định"}
        </button>
      </div>
    </form>
  );
}
