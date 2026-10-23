"use client";

import Link from "next/link";
import { useActionState, useState, type ComponentProps, type FormEvent } from "react";
import { isLocalDate } from "@/shared/kernel/local-date";
import { formatVnd, parseVnd } from "@/shared/kernel/vnd";
import type { CustomerSummary } from "../application/prepare-new-installment";
import { previewInstallment } from "../application/preview";
import { createInstallmentAction, type CreateInstallmentState } from "./actions";
import { formatDay } from "./format";

type Snapshot = { amountGiven: string; totalDue: string; totalDays: string; periodDays: string; startDate: string };

export function InstallmentForm({
  today,
  customer,
}: {
  today: string;
  /** Khách có sẵn khi mở từ trang khách; null = nhập khách mới. */
  customer: CustomerSummary | null;
}) {
  const initialState: CreateInstallmentState = { error: null, values: { customerId: customer?.id ?? "", startDate: today } };
  const [state, formAction, pending] = useActionState(createInstallmentAction, initialState);
  const v = state.values;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    amountGiven: v.amountGiven ?? "",
    totalDue: v.totalDue ?? "",
    totalDays: v.totalDays ?? "",
    periodDays: v.periodDays ?? "",
    startDate: v.startDate,
  }));

  function onInput(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    setSnapshot({
      amountGiven: text("amountGiven"),
      totalDue: text("totalDue"),
      totalDays: text("totalDays"),
      periodDays: text("periodDays"),
      startDate: text("startDate"),
    });
  }

  return (
    <form
      action={formAction}
      onInput={onInput}
      onChange={onInput}
      className="mt-6 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start"
    >
      <div className="flex flex-col gap-6">
        <section className="card p-5" aria-labelledby="s-customer">
          <h2 id="s-customer" className="font-semibold">
            Thông tin khách hàng
          </h2>
          <input type="hidden" name="customerId" value={customer?.id ?? ""} />
          {customer ? (
            <div className="mt-4 flex flex-wrap items-start gap-4">
              <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm" aria-label="Khách có sẵn">
                <dt className="text-slate-500">Khách hàng</dt>
                <dd className="font-medium">{customer.fullName}</dd>
                <dt className="text-slate-500">Số điện thoại</dt>
                <dd className="num">{customer.phone ?? "—"}</dd>
                <dt className="text-slate-500">Số CCCD</dt>
                <dd className="num">{customer.cccdMasked ?? "—"}</dd>
              </dl>
              <Link href="/tra-gop/moi" className="ml-auto text-sm text-teal-700 hover:underline">
                Nhập khách mới
              </Link>
            </div>
          ) : (
            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <Field label="Tên khách hàng" name="fullName" defaultValue={v.fullName} required maxLength={100} placeholder="Họ và tên" />
              <Field label="Số CCCD" name="cccd" defaultValue={v.cccd} inputMode="numeric" maxLength={30} />
              <Field label="Số điện thoại" name="phone" defaultValue={v.phone} inputMode="tel" maxLength={30} />
              <Field label="Địa chỉ" name="address" defaultValue={v.address} maxLength={255} />
            </div>
          )}
        </section>

        <section className="card p-5" aria-labelledby="s-loan">
          <h2 id="s-loan" className="font-semibold">
            Thông tin góp
          </h2>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <Field
              label="Tiền đưa khách (đồng)"
              name="amountGiven"
              defaultValue={v.amountGiven}
              inputMode="numeric"
              required
              maxLength={30}
              className="num"
            />
            <Field
              label="Tổng tiền phải thu (đồng)"
              name="totalDue"
              defaultValue={v.totalDue}
              inputMode="numeric"
              required
              maxLength={30}
              className="num"
            />
            <Field
              label="Số ngày góp"
              name="totalDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={v.totalDays}
              required
              className="num"
            />
            <Field
              label="Số ngày mỗi kỳ"
              name="periodDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={v.periodDays}
              required
              className="num"
            />
            <Field label="Ngày bắt đầu" name="startDate" type="date" defaultValue={v.startDate} max={today} required />
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
            {pending ? "Đang lưu…" : "Lưu hợp đồng"}
          </button>
          <Link href="/tra-gop" className="btn btn-outline w-full">
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

const wholeDays = (text: string) => {
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 1 && n <= 3650 ? n : null;
};

/** Xem trước để người nhập tự kiểm; server tính lại khi lưu. Thiếu hoặc sai dữ liệu thì hiện "—". */
function Summary({ snapshot }: { snapshot: Snapshot }) {
  const amountGiven = parseVnd(snapshot.amountGiven);
  const totalDue = parseVnd(snapshot.totalDue);
  const totalDays = wholeDays(snapshot.totalDays);
  const periodDays = wholeDays(snapshot.periodDays);
  const preview =
    amountGiven?.isPositive() &&
    totalDue &&
    totalDue.compare(amountGiven) >= 0 &&
    totalDays &&
    periodDays &&
    periodDays <= totalDays &&
    isLocalDate(snapshot.startDate)
      ? previewInstallment({ amountGiven, totalDue, totalDays, periodDays, startDate: snapshot.startDate })
      : null;
  const warning = !preview || preview.warning === "none" ? null : WARNING[preview.warning];

  return (
    <>
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <Row term="Tiền giao khách" value={amountGiven && `${formatVnd(amountGiven)} đ`} />
        <Row term="Số kỳ" value={preview && String(preview.periods)} />
        <Row term="Tiền góp mỗi kỳ" value={preview && `${formatVnd(preview.perPeriod)} đ`} />
        <Row term="Tiền lời" value={preview && `${formatVnd(preview.profit)} đ`} />
        <Row term="Kỳ góp đầu tiên" value={preview && formatDay(preview.firstDue)} />
        <Row term="Ngày kết thúc" value={preview && formatDay(preview.end)} />
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
      <p className="mt-3 text-xs text-slate-500">Quỹ két sẽ ghi một khoản chi bằng tiền đưa khách khi lưu.</p>
    </>
  );
}

function Row({ term, value }: { term: string; value: string | null | undefined | false }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{term}</dt>
      <dd className="num font-semibold">{value || "—"}</dd>
    </div>
  );
}
