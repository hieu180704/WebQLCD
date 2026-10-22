import Link from "next/link";
import { z } from "zod";
import { getCashDay, requireProfile } from "@/composition-root";
import { isLocalDate } from "@/shared/kernel/local-date";
import { formatVnd } from "@/shared/kernel/vnd";
import type { CashLine } from "../application/ports";
import { CashStatus, CashStatusMessage } from "./cash-status";
import { CashSummary, formatDateTime, formatTime, TYPE_LABEL } from "./cash-summary";
import { ManualEntryDialogs } from "./manual-entry-dialogs";
import { OpeningBalanceForm } from "./opening-balance-form";
import { ReverseEntryButton, ReverseEntryDialog } from "./reverse-entry-dialog";

// Tham số URL sai định dạng thì bỏ qua (về hôm nay / trang đầu), không báo lỗi.
const querySchema = z.object({
  ngay: z.string().refine(isLocalDate).nullable().catch(null),
  sau: z.uuid().nullable().catch(null),
});

const formatDay = (date: string) => date.split("-").reverse().join("/");

export async function CashbookPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireProfile();
  const { ngay, sau } = querySchema.parse({
    ngay: first(query.ngay),
    sau: first(query.sau),
  });
  const view = await getCashDay.execute(principal.shopId, ngay, sau);
  const isOwner = principal.role === "owner";

  return (
    <CashStatus>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quỹ két</h1>
          <p className="text-sm text-slate-500">Ngày {formatDay(view.date)}</p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-3">
          <ManualEntryDialogs today={formatDay(view.today)} userName={principal.userName} isOwner={isOwner} />
        </div>
      </div>
      <CashStatusMessage />

      <div className="mt-4 flex">
        <form className="ml-auto flex items-end gap-2" action="/quy-ket">
          <div className="field">
            <label htmlFor="ngay">Ngày</label>
            <input id="ngay" name="ngay" type="date" defaultValue={view.date} max={view.today} className="input" />
          </div>
          <button type="submit" className="btn btn-outline">
            Xem
          </button>
        </form>
      </div>

      {/* Không gắn aria-labelledby: region "Tổng két trong ngày" đã nằm trong CashSummary. */}
      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Sổ quỹ ngày {formatDay(view.date)}</h2>
          <span className="text-xs text-slate-500">Quỹ đầu ngày − Tổng chi + Tổng thu = Tiền cuối ngày</span>
        </div>
        <div className="mt-4">
          <CashSummary summary={view.summary} />
        </div>
      </section>

      {!view.openingBalanceSet && isOwner && (
        <section className="card mt-6 p-5 max-w-sm" aria-labelledby="opening-title">
          <h2 id="opening-title" className="font-semibold">
            Nhập quỹ đầu két
          </h2>
          <div className="mt-4">
            <OpeningBalanceForm />
          </div>
        </section>
      )}

      <section className="card mt-6" aria-labelledby="lines-title">
        <div className="p-5 pb-3">
          <h2 id="lines-title" className="font-semibold">
            Giao dịch trong ngày
          </h2>
        </div>
        {view.lines.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">Chưa có giao dịch nào.</p>
        ) : (
          <ReverseEntryDialog>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Giờ</th>
                    <th>Loại</th>
                    <th>Nội dung</th>
                    <th className="text-right">Thu</th>
                    <th className="text-right">Chi</th>
                    <th>Người thực hiện</th>
                    {isOwner && <th>Thao tác</th>}
                  </tr>
                </thead>
                <tbody>
                  {view.lines.map((line) => {
                    const magnitude = formatVnd(line.amount.isNegative() ? line.amount.negate() : line.amount);
                    return (
                      <tr key={line.id}>
                        <td className="num">{formatTime(line.occurredAt)}</td>
                        <td className="whitespace-nowrap">
                          {TYPE_LABEL[line.type]}
                          {line.reversed && <span className="badge badge-late ml-2">Đã huỷ</span>}
                        </td>
                        <td>
                          <LineContent line={line} />
                        </td>
                        <td className="text-right num font-medium text-emerald-700">{line.amount.isNegative() ? "" : magnitude}</td>
                        <td className="text-right num font-medium text-red-700">{line.amount.isNegative() ? magnitude : ""}</td>
                        <td>{line.createdByName}</td>
                        {isOwner && (
                          <td>
                            {line.reversible && (
                              <ReverseEntryButton
                                transactionId={line.id}
                                summary={`${TYPE_LABEL[line.type]} ${magnitude} lúc ${formatTime(line.occurredAt)}${line.note ? ` — ${line.note}` : ""}`}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ReverseEntryDialog>
        )}
        {view.nextAfter && (
          <div className="p-4">
            <Link
              href={{
                pathname: "/quy-ket",
                query: { ngay: view.date, sau: view.nextAfter },
              }}
              className="btn btn-outline !h-9"
            >
              Xem tiếp
            </Link>
          </div>
        )}
      </section>
    </CashStatus>
  );
}

/**
 * Nội dung một dòng: phiếu thì là nội dung đã nhập; giao dịch hợp đồng thì là mã (link sang chi tiết, nơi huỷ thao tác);
 * dòng đảo thì nêu dòng bị huỷ kèm lý do.
 */
function LineContent({ line }: { line: CashLine }) {
  const contract = line.contractId && line.contractCode && (
    <Link href={`/cam-do/${line.contractId}`} className="text-teal-700 hover:underline">
      {line.contractCode}
    </Link>
  );
  if (line.reverses) {
    return (
      <>
        Huỷ &ldquo;{TYPE_LABEL[line.reverses.type]}
        {contract && <> {contract}</>}&rdquo; lúc {formatDateTime(line.reverses.occurredAt)}
        {line.note && <> — lý do: {line.note}</>}
      </>
    );
  }
  if (!contract && !line.note) return <span className="text-slate-400">—</span>;
  return (
    <>
      {contract}
      {contract && line.note && " · "}
      {line.note}
    </>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
