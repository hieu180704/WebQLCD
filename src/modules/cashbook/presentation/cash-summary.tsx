import { formatVnd } from "@/shared/kernel/vnd";
import type { CashDayView } from "../application/get-cash-day";
import type { CashLine, CashTransactionType } from "../application/ports";

export const TYPE_LABEL: Record<CashTransactionType, string> = {
  opening_balance: "Quỹ đầu két",
  capital_in: "Nạp vốn",
  manual_income: "Thu khác",
  manual_expense: "Chi khác",
  disbursement: "Giải ngân",
  additional_loan: "Vay thêm",
  interest_payment: "Thu lãi",
  principal_repayment: "Trả gốc",
  installment_disbursement: "Giải ngân trả góp",
  installment_payment: "Thu trả góp",
  reversal: "Bút toán đảo",
};

export const formatTime = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", timeStyle: "short" }).format;
export const formatDateTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
}).format;

const amountClass = (amount: CashLine["amount"]) => (amount.isNegative() ? "text-red-700" : "text-emerald-700");

/** 4 ô tổng két theo mockup dashboard: Quỹ đầu ngày − Tổng chi + Tổng thu = Tiền cuối ngày. */
export function CashSummary({ summary }: { summary: CashDayView["summary"] }) {
  return (
    <section aria-label="Tổng két trong ngày" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Tile label="Quỹ đầu ngày" value={formatVnd(summary.opening)} />
      <Tile label="Tổng chi" value={formatVnd(summary.expense)} valueClass="text-red-700" />
      <Tile label="Tổng thu" value={formatVnd(summary.income)} valueClass="text-emerald-700" />
      <div className="rounded-lg bg-teal-700 text-white p-4">
        <div className="text-sm text-teal-100">Tiền cuối ngày</div>
        <div className="mt-1 text-base sm:text-xl font-bold num whitespace-nowrap">{formatVnd(summary.closing)}</div>
      </div>
    </section>
  );
}

function Tile({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-base sm:text-xl font-bold num whitespace-nowrap ${valueClass}`}>{value}</div>
    </div>
  );
}

/** Danh sách giao dịch gọn cho trang chủ (mockup dashboard, khối "Giao dịch hôm nay"). */
export function CashLineList({ lines }: { lines: CashLine[] }) {
  if (lines.length === 0) return <p className="px-5 pb-5 text-sm text-slate-500">Chưa có giao dịch nào.</p>;
  return (
    <ul className="px-5 pb-4 divide-y divide-slate-100 text-sm">
      {lines.map((line) => (
        <li key={line.id} className="py-3 flex gap-3">
          <span className="text-slate-400 num w-11">{formatTime(line.occurredAt)}</span>
          <div className="flex-1 min-w-0">
            <div className="truncate">
              {TYPE_LABEL[line.type]}
              {line.contractCode && ` ${line.contractCode}`}
            </div>
            <div className="text-xs text-slate-500">NV: {line.createdByName}</div>
          </div>
          <span className={`num font-medium ${amountClass(line.amount)}`}>{formatVnd(line.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
