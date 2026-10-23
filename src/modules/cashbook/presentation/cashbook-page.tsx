import Link from "next/link";
import { getCashDay, listCashActors, requireProfile } from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import { CASH_TYPE_GROUPS } from "../application/cash-filter";
import type { CashLine } from "../application/ports";
import { parseCashQuery } from "./cash-query";
import { CashStatus, CashStatusMessage } from "./cash-status";
import { CashSummary, formatDateTime, formatTime, TYPE_LABEL } from "./cash-summary";
import { ManualEntryDialogs } from "./manual-entry-dialogs";
import { OpeningBalanceForm } from "./opening-balance-form";
import { ReverseEntryButton, ReverseEntryDialog } from "./reverse-entry-dialog";

type CashQuery = { ngay?: string | null; loai?: string | null; nv?: string | null; sau?: string | null };

/** Link trong trang quỹ két; bỏ tham số rỗng để URL gọn. */
const cashHref = (query: CashQuery) => ({ pathname: "/quy-ket", query: Object.fromEntries(Object.entries(query).filter(([, v]) => v)) });

const formatDay = (date: string) => date.split("-").reverse().join("/");

export async function CashbookPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireProfile();
  const { ngay, group, nv, sau } = parseCashQuery((key) => first(query[key]));
  const [view, actors] = await Promise.all([
    getCashDay.execute(principal.shopId, ngay, sau, { group, createdBy: nv }),
    listCashActors.execute(principal.shopId),
  ]);
  const filters = { loai: group, nv };
  const filtered = Boolean(group || nv);
  const isOwner = principal.role === "owner";
  // Xuất đúng ngày + bộ lọc đang xem, cả ngày (không theo trang).
  const exportQuery = new URLSearchParams(
    Object.entries({ ngay: view.date, ...filters }).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();

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

      <nav aria-label="Chọn ngày" className="mt-4 flex flex-wrap items-end justify-end gap-2">
        <Link href={cashHref({ ...filters, ngay: view.prevDate })} className="btn btn-outline" aria-label="Ngày trước">
          ‹
        </Link>
        <form className="flex items-end gap-2" action="/quy-ket">
          {group && <input type="hidden" name="loai" value={group} />}
          {nv && <input type="hidden" name="nv" value={nv} />}
          <div className="field">
            <label htmlFor="ngay">Ngày</label>
            <input id="ngay" name="ngay" type="date" defaultValue={view.date} max={view.today} className="input" />
          </div>
          <button type="submit" className="btn btn-outline">
            Xem
          </button>
        </form>
        {view.nextDate ? (
          <Link href={cashHref({ ...filters, ngay: view.nextDate })} className="btn btn-outline" aria-label="Ngày sau">
            ›
          </Link>
        ) : (
          <span className="btn btn-outline opacity-40" aria-hidden="true">
            ›
          </span>
        )}
        <Link href={cashHref(filters)} className="btn btn-outline">
          Hôm nay
        </Link>
      </nav>

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
          <form action="/quy-ket" className="mt-3 flex flex-wrap items-end gap-2" aria-label="Lọc giao dịch">
            <input type="hidden" name="ngay" value={view.date} />
            <div className="field">
              <label htmlFor="loai">Loại giao dịch</label>
              <select id="loai" name="loai" defaultValue={group ?? ""} className="input">
                <option value="">Tất cả</option>
                {Object.entries(CASH_TYPE_GROUPS).map(([key, { label }]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nv">Người thực hiện</label>
              <select id="nv" name="nv" defaultValue={nv ?? ""} className="input">
                <option value="">Tất cả</option>
                {actors.map((actor) => (
                  <option key={actor.id} value={actor.id}>
                    {actor.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-outline">
              Lọc
            </button>
            {filtered && (
              <Link href={cashHref({ ngay: view.date })} className="btn btn-outline">
                Bỏ lọc
              </Link>
            )}
            {isOwner && (
              <a href={`/quy-ket/xuat-excel?${exportQuery}`} className="btn btn-outline sm:ml-auto" download>
                Xuất Excel
              </a>
            )}
          </form>
        </div>
        {view.lines.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">{filtered ? "Không có giao dịch phù hợp." : "Chưa có giao dịch nào."}</p>
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
            <Link href={cashHref({ ngay: view.date, ...filters, sau: view.nextAfter })} className="btn btn-outline !h-9">
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
