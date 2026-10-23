import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCashReport, requireSession } from "@/composition-root";
import { isLocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { formatVnd } from "@/shared/kernel/vnd";
import type { CashType, ReportRange } from "../application/get-cash-report";

// Tên và thứ tự dòng theo mockup bao-cao.html: thu trước, chi sau, dòng đảo cuối.
const TYPE_ROWS: [Exclude<CashType, "opening_balance">, string][] = [
  ["interest_payment", "Đóng lãi (cầm đồ, tín chấp)"],
  ["principal_repayment", "Trả gốc, chuộc đồ"],
  ["installment_payment", "Tiền góp (trả góp)"],
  ["manual_income", "Thu khác"],
  ["capital_in", "Nạp vốn"],
  ["disbursement", "Giải ngân cầm đồ, tín chấp"],
  ["additional_loan", "Vay thêm"],
  ["installment_disbursement", "Giải ngân trả góp"],
  ["manual_expense", "Chi khác"],
  ["reversal", "Bút toán đảo (huỷ, xoá)"],
];

// Tham số URL sai định dạng thì bỏ qua (dùng mặc định), không báo lỗi.
const date = z.string().refine(isLocalDate).nullable().catch(null);
const querySchema = z.object({ tu: date, den: date, truoc: date });

/** "2026-10-05" → "05/10/2026". */
const formatDay = (value: string) => value.split("-").reverse().join("/");

const rangeHref = (range: ReportRange, truoc?: string) => ({
  pathname: "/bao-cao",
  query: { tu: range.from, den: range.to, ...(truoc && { truoc }) },
});

const sameRange = (a: ReportRange, b: ReportRange) => a.from === b.from && a.to === b.to;

function Amount({ value, tone }: { value: Money; tone: "in" | "out" }) {
  if (value.isZero()) return null;
  // Chi mang dấu âm, hiện độ lớn.
  return <span className={tone === "in" ? "text-emerald-700" : "text-red-700"}>{formatVnd(tone === "in" ? value : value.negate())}</span>;
}

export async function ReportPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  if (principal.role !== "owner") redirect("/");
  const params = querySchema.parse({ tu: first(query.tu), den: first(query.den), truoc: first(query.truoc) });
  const view = await getCashReport.execute(principal.shopId, { from: params.tu, to: params.den, before: params.truoc });
  const { range, report } = view;
  const period = range.from === range.to ? formatDay(range.from) : `${formatDay(range.from)} – ${formatDay(range.to)}`;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Báo cáo</h1>
        <p className="text-sm text-slate-500">Tổng kết giao dịch theo khoảng thời gian</p>
      </div>

      <form action="/bao-cao" className="card mt-6 p-4 flex flex-wrap gap-3 items-end" aria-label="Chọn khoảng thời gian">
        <nav className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg" aria-label="Chọn nhanh">
          {view.presets.map((preset) => {
            const current = sameRange(preset.range, range);
            return (
              <Link
                key={preset.key}
                href={rangeHref(preset.range)}
                aria-current={current ? "page" : undefined}
                className={`h-9 px-3 rounded-md text-sm font-medium inline-flex items-center ${current ? "bg-white shadow-sm" : "text-slate-600"}`}
              >
                {preset.label}
              </Link>
            );
          })}
        </nav>
        <div className="field">
          <label htmlFor="tu">Từ ngày</label>
          <input id="tu" name="tu" type="date" defaultValue={range.from} max={view.today} className="input w-44" />
        </div>
        <div className="field">
          <label htmlFor="den">Đến ngày</label>
          <input id="den" name="den" type="date" defaultValue={range.to} max={view.today} className="input w-44" />
        </div>
        <button type="submit" className="btn btn-outline">
          Xem
        </button>
      </form>

      {!report && (
        <p role="alert" className="card mt-6 p-5 text-sm text-red-700">
          Từ ngày phải trước hoặc trùng đến ngày.
        </p>
      )}
      {report && (
        <>
          <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label={`Tổng quan ${period}`}>
            <div className="card p-4">
              <div className="text-sm text-slate-500">Quỹ đầu kỳ ({formatDay(range.from).slice(0, 5)})</div>
              <div className="mt-1 text-lg font-bold num">{formatVnd(report.opening)}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-slate-500">Tổng thu</div>
              <div className="mt-1 text-lg font-bold num text-emerald-700">{formatVnd(report.income)}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-slate-500">Tổng chi</div>
              <div className="mt-1 text-lg font-bold num text-red-700">{formatVnd(report.expense.negate())}</div>
            </div>
            <div className="card p-4 !border-teal-700 bg-teal-50/40">
              <div className="text-sm text-slate-500">Quỹ cuối kỳ ({formatDay(range.to).slice(0, 5)})</div>
              <div className="mt-1 text-lg font-bold num">{formatVnd(report.closing)}</div>
            </div>
          </section>

          <section className="card mt-6" aria-labelledby="t-type">
            <h2 id="t-type" className="p-5 pb-3 font-semibold">
              Theo loại giao dịch
            </h2>
            {report.byType.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-slate-500">Không có giao dịch trong kỳ.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Loại</th>
                      <th className="text-right">Số lần</th>
                      <th className="text-right">Thu</th>
                      <th className="text-right">Chi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TYPE_ROWS.map(([type, label]) => {
                      const row = report.byType.find((r) => r.type === type);
                      if (!row) return null;
                      return (
                        <tr key={type}>
                          <td>{label}</td>
                          <td className="text-right num">{row.count}</td>
                          <td className="text-right num">
                            <Amount value={row.income} tone="in" />
                          </td>
                          <td className="text-right num">
                            <Amount value={row.expense} tone="out" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="p-3">Cộng</td>
                      <td></td>
                      <td className="p-3 text-right num text-emerald-700">{formatVnd(report.income)}</td>
                      <td className="p-3 text-right num text-red-700">{formatVnd(report.expense.negate())}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="card mt-6" aria-labelledby="t-day">
            <h2 id="t-day" className="p-5 pb-3 font-semibold">
              Theo ngày
            </h2>
            {report.days.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-slate-500">Không có ngày nào có giao dịch trong kỳ.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th className="text-right">Quỹ đầu ngày</th>
                      <th className="text-right">Thu</th>
                      <th className="text-right">Chi</th>
                      <th className="text-right">Tiền cuối ngày</th>
                      <th>
                        <span className="sr-only">Xem</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((day) => (
                      <tr key={day.date}>
                        <td className="num">{formatDay(day.date)}</td>
                        <td className="text-right num">{formatVnd(day.opening)}</td>
                        <td className="text-right num text-emerald-700">{formatVnd(day.income)}</td>
                        <td className="text-right num text-red-700">{formatVnd(day.expense.negate())}</td>
                        <td className="text-right num font-semibold">{formatVnd(day.closing)}</td>
                        <td>
                          <Link
                            href={{ pathname: "/quy-ket", query: { ngay: day.date } }}
                            className="text-sm text-teal-700 hover:underline"
                            aria-label={`Chi tiết ngày ${formatDay(day.date)}`}
                          >
                            Chi tiết
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.nextBefore && (
              <div className="p-4">
                <Link href={rangeHref(range, report.nextBefore)} className="btn btn-outline !h-9">
                  Xem các ngày trước
                </Link>
              </div>
            )}
          </section>
        </>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Mọi con số tính từ sổ két, cùng cách tính với sổ quỹ: giao dịch bị huỷ vẫn tính ở ngày ghi, bút toán đảo tính ở ngày huỷ. Chỉ chủ
        tiệm xem được báo cáo.
      </p>
    </>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
