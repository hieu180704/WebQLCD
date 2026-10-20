import Link from "next/link";
import { z } from "zod";
import { getCashDay, requireSession } from "@/composition-root";
import { isLocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { formatVnd } from "@/shared/kernel/vnd";
import type { CashTransactionType } from "../application/ports";
import { OpeningBalanceForm } from "./opening-balance-form";

const TYPE_LABEL: Record<CashTransactionType, string> = {
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

// Tham số URL sai định dạng thì bỏ qua (về hôm nay / trang đầu), không báo lỗi.
const querySchema = z.object({
  ngay: z.string().refine(isLocalDate).nullable().catch(null),
  sau: z.uuid().nullable().catch(null),
});

const formatTime = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", timeStyle: "short" }).format;
const formatDay = (date: string) => date.split("-").reverse().join("/");

export async function CashbookPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  const { ngay, sau } = querySchema.parse({ ngay: first(query.ngay), sau: first(query.sau) });
  const view = await getCashDay.execute(principal.shopId, ngay, sau);
  const { summary } = view;

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-wrap items-end gap-2" action="/quy-ket">
        <label htmlFor="ngay" className="text-sm">
          Ngày
        </label>
        <input id="ngay" name="ngay" type="date" defaultValue={view.date} max={view.today} className="rounded-md border px-2 py-1 text-sm" />
        <button type="submit" className="rounded-md border px-3 py-1 text-sm">
          Xem
        </button>
      </form>

      <section aria-label="Tổng két trong ngày" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Quỹ đầu ngày" value={summary.opening} />
        <Stat label="Tổng thu" value={summary.income} />
        <Stat label="Tổng chi" value={summary.expense} />
        <Stat label="Tiền cuối ngày" value={summary.closing} />
      </section>
      <p className="text-xs text-muted-foreground">
        Tiền cuối ngày = Quỹ đầu ngày − Tổng chi + Tổng thu. Ngày {formatDay(view.date)}.
      </p>

      {!view.openingBalanceSet && principal.role === "owner" && (
        <section className="max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 font-semibold">Nhập quỹ đầu két</h2>
          <OpeningBalanceForm />
        </section>
      )}

      <section>
        <h2 className="mb-4 font-semibold">Giao dịch trong ngày</h2>
        {view.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có giao dịch nào.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Giờ</th>
                <th className="py-2 font-medium">Loại</th>
                <th className="py-2 font-medium">Hợp đồng</th>
                <th className="py-2 text-right font-medium">Số tiền</th>
                <th className="py-2 pl-4 font-medium">Người thực hiện</th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => (
                <tr key={line.id} className="border-t">
                  <td className="py-2">{formatTime(line.occurredAt)}</td>
                  <td className="py-2">{TYPE_LABEL[line.type]}</td>
                  <td className="py-2">{line.contractCode ?? "—"}</td>
                  <td className={`py-2 text-right tabular-nums ${line.amount.isNegative() ? "text-destructive" : ""}`}>
                    {formatVnd(line.amount)}
                  </td>
                  <td className="py-2 pl-4">{line.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.nextAfter && (
          <Link href={{ pathname: "/quy-ket", query: { ngay: view.date, sau: view.nextAfter } }} className="mt-4 inline-block text-sm underline underline-offset-4">
            Xem tiếp
          </Link>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: Money }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${value.isNegative() ? "text-destructive" : ""}`}>{formatVnd(value)}</p>
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
