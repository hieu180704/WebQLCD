"use client";

import Link from "next/link";
import { useActionState, useState, type ComponentProps, type FormEvent } from "react";
import { formatVnd, parseVnd } from "@/shared/kernel/vnd";
import { parseRate, previewContract, type InterestType } from "../application/preview";
import { createContractAction, type CreateContractState } from "./actions";
import { INTEREST_TYPE_OPTIONS as INTEREST_TYPES } from "./format";

const RATE_UNIT: Record<InterestType, string> = {
  per_million_per_day: "(k / triệu / ngày)",
  percent_per_month: "(% / tháng)",
  percent_per_week: "(% / tuần)",
};

type Snapshot = { kind: string; principal: string; interestType: string; interestRate: string; interestPeriodDays: string; prepaidInterest: boolean };

/** Giá trị điền sẵn theo cài đặt của cửa hàng; `interestRate` null = không điền sẵn. */
export type FormDefaults = {
  interestType: InterestType;
  interestRate: string | null;
  termDays: number;
  interestPeriodDays: number;
  prepaidInterest: boolean;
};

export function ContractForm({ today, defaults }: { today: string; defaults: FormDefaults }) {
  const initialState: CreateContractState = {
    error: null,
    values: {
      kind: "secured",
      loanDate: today,
      interestType: defaults.interestType,
      interestRate: defaults.interestRate?.replace(".", ",") ?? "",
      termDays: String(defaults.termDays),
      interestPeriodDays: String(defaults.interestPeriodDays),
      prepaidInterest: defaults.prepaidInterest ? "on" : "",
    },
  };
  const [state, formAction, pending] = useActionState(createContractAction, initialState);
  const v = state.values;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    kind: v.kind,
    principal: v.principal ?? "",
    interestType: v.interestType,
    interestRate: v.interestRate ?? "",
    interestPeriodDays: v.interestPeriodDays,
    prepaidInterest: v.prepaidInterest === "on",
  }));

  function onInput(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    setSnapshot({
      kind: text("kind"),
      principal: text("principal"),
      interestType: text("interestType"),
      interestRate: text("interestRate"),
      interestPeriodDays: text("interestPeriodDays"),
      prepaidInterest: data.get("prepaidInterest") === "on",
    });
  }

  return (
    <form action={formAction} onInput={onInput} onChange={onInput} className="mt-6 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
      <div className="flex flex-col gap-6">
        <section className="card p-5" aria-labelledby="s-customer">
          <h2 id="s-customer" className="font-semibold">
            Thông tin khách hàng
          </h2>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <Field label="Tên khách hàng" name="fullName" defaultValue={v.fullName} required maxLength={100} placeholder="Họ và tên" />
            <Field label="Số CCCD" name="cccd" defaultValue={v.cccd} inputMode="numeric" maxLength={30} />
            <Field label="Số điện thoại" name="phone" defaultValue={v.phone} inputMode="tel" maxLength={30} />
            <Field label="Địa chỉ" name="address" defaultValue={v.address} maxLength={255} />
          </div>
        </section>

        <section className="card p-5" aria-labelledby="s-loan">
          <h2 id="s-loan" className="font-semibold">
            Thông tin khoản vay
          </h2>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <div className="field">
              <label htmlFor="kind">
                Loại tài sản <span className="req">*</span>
              </label>
              <select id="kind" name="kind" defaultValue={v.kind} className="input">
                <option value="secured">Thế chấp (cầm đồ)</option>
                <option value="unsecured">Tín chấp</option>
              </select>
            </div>
            {/* Tín chấp không có tài sản: bỏ hẳn ô (không chỉ ẩn) để không gửi ngầm tên đã gõ trước khi đổi loại. */}
            {snapshot.kind !== "unsecured" && (
              <Field label="Tên tài sản" name="assetName" defaultValue={v.assetName} maxLength={200} placeholder="VD: Honda Vision 2022, biển 59X1-xxx.xx" />
            )}
            <Field label="Số tiền vay (đồng)" name="principal" defaultValue={v.principal} inputMode="numeric" required maxLength={30} className="num" />
            <Field label="Ngày vay" name="loanDate" type="date" defaultValue={v.loanDate} max={today} required />
            <div className="field">
              <label htmlFor="interestType">
                Hình thức lãi <span className="req">*</span>
              </label>
              <select id="interestType" name="interestType" defaultValue={v.interestType} className="input">
                {INTEREST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              {/* Đơn vị nằm ngoài <label> để tên ô giữ đúng "Lãi *". */}
              <div className="flex items-baseline gap-1">
                <label htmlFor="interestRate" className="field-label">
                  Lãi <span className="req">*</span>
                </label>
                <span className="text-[13px] text-slate-500">{RATE_UNIT[snapshot.interestType as InterestType] ?? ""}</span>
              </div>
              <input id="interestRate" name="interestRate" className="input num" autoComplete="off" defaultValue={v.interestRate} inputMode="decimal" required maxLength={20} />
            </div>
            <Field label="Số ngày vay" name="termDays" type="number" min={1} max={3650} defaultValue={v.termDays} required className="num" />
            <Field label="Kỳ lãi (số ngày mỗi lần đóng)" name="interestPeriodDays" type="number" min={1} max={3650} defaultValue={v.interestPeriodDays} required className="num" />
            <label className="sm:col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="prepaidInterest" defaultChecked={v.prepaidInterest === "on"} />
              Thu lãi trước (trừ lãi kỳ đầu vào tiền giao khách)
            </label>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="s-other">
          <h2 id="s-other" className="font-semibold">
            Thông tin khác
          </h2>
          <div className="mt-4 field">
            <label htmlFor="note">Ghi chú</label>
            <textarea id="note" name="note" defaultValue={v.note} maxLength={500} rows={3} className="input" />
          </div>
        </section>
      </div>

      <section className="card p-5 xl:sticky xl:top-6" aria-labelledby="s-summary">
        <h2 id="s-summary" className="font-semibold">
          Tóm tắt
        </h2>
        <Summary snapshot={snapshot} />
        <p role="alert" aria-live="polite" className="mt-3 min-h-5 text-sm text-red-700">
          {state.error}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="submit" className="btn btn-primary w-full" disabled={pending}>
            {pending ? "Đang lưu…" : "Lưu hợp đồng và giải ngân"}
          </button>
          <Link href="/cam-do" className="btn btn-outline w-full">
            Huỷ
          </Link>
        </div>
      </section>
    </form>
  );
}

function Field({ label, name, required, className = "", ...props }: ComponentProps<"input"> & { label: string; name: string }) {
  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required && (
          <>
            {" "}
            <span className="req">*</span>
          </>
        )}
      </label>
      <input id={name} name={name} required={required} autoComplete="off" className={`input ${className}`} {...props} />
    </div>
  );
}

const WARNING: Record<"above_civil_cap" | "criminal_risk", { text: string; className: string }> = {
  above_civil_cap: {
    text: "vượt 20%/năm, mức trần thoả thuận theo Điều 468 Bộ luật Dân sự 2015.",
    className: "bg-amber-50 text-amber-800",
  },
  criminal_risk: {
    text: "từ 100%/năm trở lên, có thể bị truy cứu theo Điều 201 Bộ luật Hình sự.",
    className: "bg-red-50 text-red-800",
  },
};

/** Xem trước để người nhập tự kiểm; server tính lại khi lưu. Thiếu dữ liệu thì hiện "—". */
function Summary({ snapshot }: { snapshot: Snapshot }) {
  const principal = parseVnd(snapshot.principal);
  const rate = parseRate(snapshot.interestRate);
  const periodDays = Number(snapshot.interestPeriodDays);
  const type = INTEREST_TYPES.find((t) => t.value === snapshot.interestType)?.value;
  const preview =
    principal?.isPositive() && rate !== null && Number.isSafeInteger(periodDays) && periodDays >= 1 && type
      ? previewContract({ principal, interestType: type, rate, periodDays, prepaidInterest: snapshot.prepaidInterest })
      : null;
  const warning = !preview || preview.warning === "none" ? null : WARNING[preview.warning];

  return (
    <>
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <Row term="Tiền giao khách" value={preview && `${formatVnd(preview.cashToCustomer)} đ`} />
        <Row term={preview ? `Lãi mỗi kỳ (${periodDays} ngày)` : "Lãi mỗi kỳ"} value={preview && `${formatVnd(preview.periodInterest)} đ`} />
        <div className="flex justify-between gap-3 border-t border-slate-200 pt-3">
          <dt className="text-slate-500">Lãi suất quy đổi</dt>
          <dd className="num font-semibold">{preview ? `${preview.annualPercent.toLocaleString("vi-VN")}% / năm` : "—"}</dd>
        </div>
      </dl>
      {warning && (
        <p role="note" className={`mt-3 text-xs rounded-lg p-3 ${warning.className}`}>
          Cảnh báo: lãi suất {warning.text} Vẫn lưu được, cửa hàng tự chịu trách nhiệm tuân thủ.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Quỹ két sẽ ghi một khoản chi bằng số tiền vay khi lưu{snapshot.prepaidInterest ? " và một khoản thu lãi kỳ đầu" : ""}.
      </p>
    </>
  );
}

function Row({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{term}</dt>
      <dd className="num font-semibold">{value ?? "—"}</dd>
    </div>
  );
}
