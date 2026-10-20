"use client";

import { useActionState, useState, type ComponentProps, type FormEvent } from "react";
import { formatVnd, parseVnd } from "@/shared/kernel/vnd";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { parseRate, previewContract, type InterestType } from "../application/preview";
import { createContractAction, type CreateContractState } from "./actions";

const INTEREST_TYPES: { value: InterestType; label: string }[] = [
  { value: "per_million_per_day", label: "Lãi ngày (k / triệu / ngày)" },
  { value: "percent_per_month", label: "Lãi tháng (% / tháng)" },
  { value: "percent_per_week", label: "Lãi tuần (% / tuần)" },
];

const SELECT_CLASS = "h-9 rounded-md border bg-transparent px-3 text-sm";

type Snapshot = { principal: string; interestType: string; interestRate: string; interestPeriodDays: string; prepaidInterest: boolean };

export function ContractForm({ today }: { today: string }) {
  const initialState: CreateContractState = {
    error: null,
    values: { kind: "secured", loanDate: today, interestType: "per_million_per_day", termDays: "30", interestPeriodDays: "10" },
  };
  const [state, formAction, pending] = useActionState(createContractAction, initialState);
  const v = state.values;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
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
      principal: text("principal"),
      interestType: text("interestType"),
      interestRate: text("interestRate"),
      interestPeriodDays: text("interestPeriodDays"),
      prepaidInterest: data.get("prepaidInterest") === "on",
    });
  }

  return (
    <form action={formAction} onInput={onInput} onChange={onInput} className="flex flex-col gap-6">
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 font-semibold">Thông tin khách hàng</legend>
        <Field label="Tên khách hàng *" name="fullName" defaultValue={v.fullName} required maxLength={100} />
        <Field label="Số CCCD" name="cccd" defaultValue={v.cccd} inputMode="numeric" maxLength={30} />
        <Field label="Số điện thoại" name="phone" defaultValue={v.phone} inputMode="tel" maxLength={30} />
        <Field label="Địa chỉ" name="address" defaultValue={v.address} maxLength={255} />
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-2 font-semibold">Thông tin khoản vay</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="kind">Loại tài sản *</Label>
          <select id="kind" name="kind" defaultValue={v.kind} className={SELECT_CLASS}>
            <option value="secured">Thế chấp (cầm đồ)</option>
            <option value="unsecured">Tín chấp</option>
          </select>
        </div>
        <Field label="Tên tài sản" name="assetName" defaultValue={v.assetName} maxLength={200} placeholder="VD: Honda Vision 2022, biển 59X1-xxx.xx" />
        <Field label="Số tiền vay (đồng) *" name="principal" defaultValue={v.principal} inputMode="numeric" required maxLength={30} />
        <Field label="Ngày vay *" name="loanDate" type="date" defaultValue={v.loanDate} max={today} required />
        <div className="flex flex-col gap-2">
          <Label htmlFor="interestType">Hình thức lãi *</Label>
          <select id="interestType" name="interestType" defaultValue={v.interestType} className={SELECT_CLASS}>
            {INTEREST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <Field label="Lãi *" name="interestRate" defaultValue={v.interestRate} inputMode="decimal" required maxLength={20} />
        <Field label="Số ngày vay *" name="termDays" type="number" min={1} max={3650} defaultValue={v.termDays} required />
        <Field label="Kỳ lãi (số ngày mỗi lần đóng) *" name="interestPeriodDays" type="number" min={1} max={3650} defaultValue={v.interestPeriodDays} required />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="prepaidInterest" defaultChecked={v.prepaidInterest === "on"} />
          Thu lãi trước (trừ lãi kỳ đầu vào tiền giao khách)
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold">Thông tin khác</legend>
        <div className="flex flex-col gap-2">
          <Label htmlFor="note">Ghi chú</Label>
          <textarea id="note" name="note" defaultValue={v.note} maxLength={500} rows={3} className="rounded-md border bg-transparent px-3 py-2 text-sm" />
        </div>
      </fieldset>

      <Summary snapshot={snapshot} />

      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
        {state.error}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Đang lưu…" : "Lưu hợp đồng và giải ngân"}
      </Button>
    </form>
  );
}

function Field({ label, name, ...props }: ComponentProps<typeof Input> & { label: string; name: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} autoComplete="off" {...props} />
    </div>
  );
}

const WARNING: Record<"above_civil_cap" | "criminal_risk", { text: string; className: string }> = {
  above_civil_cap: {
    text: "vượt 20%/năm, mức trần thoả thuận theo Điều 468 Bộ luật Dân sự 2015.",
    className: "border-yellow-500/50 bg-yellow-500/10",
  },
  criminal_risk: {
    text: "từ 100%/năm trở lên, có thể bị truy cứu theo Điều 201 Bộ luật Hình sự.",
    className: "border-destructive/50 bg-destructive/10 text-destructive",
  },
};

/** Xem trước để người nhập tự kiểm; server tính lại khi lưu. */
function Summary({ snapshot }: { snapshot: Snapshot }) {
  const principal = parseVnd(snapshot.principal);
  const rate = parseRate(snapshot.interestRate);
  const periodDays = Number(snapshot.interestPeriodDays);
  const type = INTEREST_TYPES.find((t) => t.value === snapshot.interestType)?.value;
  if (!principal?.isPositive() || rate === null || !Number.isSafeInteger(periodDays) || periodDays < 1 || !type) {
    return <p className="text-sm text-muted-foreground">Nhập số tiền vay, lãi và kỳ lãi để xem tóm tắt.</p>;
  }
  const preview = previewContract({ principal, interestType: type, rate, periodDays, prepaidInterest: snapshot.prepaidInterest });
  const warning = preview.warning === "none" ? null : WARNING[preview.warning];

  return (
    <section aria-label="Tóm tắt" className="flex flex-col gap-2 rounded-xl border bg-muted p-4 text-sm">
      <p>
        Lãi mỗi kỳ ({periodDays} ngày): <strong className="tabular-nums">{formatVnd(preview.periodInterest)}</strong> đồng
      </p>
      <p>
        Tiền giao khách: <strong className="tabular-nums">{formatVnd(preview.cashToCustomer)}</strong> đồng
      </p>
      <p>Lãi suất quy đổi: {preview.annualPercent.toLocaleString("vi-VN")}%/năm</p>
      {warning && (
        <p role="note" className={`rounded-md border px-3 py-2 ${warning.className}`}>
          Cảnh báo: lãi suất {warning.text} Vẫn lưu được, cửa hàng tự chịu trách nhiệm tuân thủ.
        </p>
      )}
    </section>
  );
}
