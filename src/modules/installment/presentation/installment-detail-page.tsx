import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { getInstallmentDetail, requireSession } from "@/composition-root";
import { BUSINESS_TIME_ZONE, businessDate, diffDays } from "@/shared/kernel/local-date";
import { formatVnd } from "@/shared/kernel/vnd";
import type { HistoryLine, InstallmentDetailView } from "../application/get-installment-detail";
import type { LatestOperation } from "../application/ports";
import { CloseDialog } from "./close-dialog";
import { DeleteDialog } from "./delete-dialog";
import { DueBadge, ProgressBar, formatDay } from "./format";
import { OperationStatus, OperationStatusMessage } from "./operation-status";
import { PayDialog } from "./pay-dialog";
import { ReverseDialog } from "./reverse-dialog";

const formatTime = new Intl.DateTimeFormat("vi-VN", { timeZone: BUSINESS_TIME_ZONE, timeStyle: "short" }).format;

/** "05/10/2026 10:15" theo giờ Việt Nam, như mockup. */
const formatDateTime = (at: Date) => `${formatDay(businessDate(at))} ${formatTime(at)}`;

/** Số tiền có dấu như mockup: "+400.000", "−4.000.000". */
const formatSigned = (amount: LatestOperation["cashNet"]) =>
  amount.isNegative() ? `−${formatVnd(amount.negate())}` : `+${formatVnd(amount)}`;

const OPERATION_LABEL: Record<LatestOperation["kind"], string> = {
  disbursement: "Giải ngân",
  pay: "Đóng tiền góp",
  close: "Đóng hợp đồng (tất toán)",
};

function reverseEffect(op: LatestOperation, closed: boolean): string {
  const cash = op.cashNet.isZero() ? "" : `Quỹ két ghi bút toán đảo ${formatSigned(op.cashNet.negate())} đ hôm nay. `;
  if (op.kind === "close") return `${cash}Hợp đồng mở lại, số đã thu trở về như trước lần tất toán.`;
  return `${cash}Số đã thu trở về như trước lần góp này.${closed ? " Hợp đồng mở lại." : ""}`;
}

function historyLabel(t: HistoryLine): string {
  switch (t.type) {
    case "installment_disbursement":
      return "Giải ngân, tạo hợp đồng";
    case "installment_payment":
      if (t.operationKind === "close") return "Tất toán";
      if (!t.periods) return "Góp tiền";
      return t.periods.first === t.periods.last ? `Góp kỳ ${t.periods.first}` : `Góp kỳ ${t.periods.first}–${t.periods.last}`;
    case "reversal":
      return t.note ? `Huỷ giao dịch — ${t.note}` : "Huỷ giao dịch";
  }
}

/**
 * Trang chi tiết hợp đồng trả góp (mockup tra-gop-chi-tiet.html). Thao tác: đóng tiền góp, đóng / tất toán; chủ tiệm huỷ
 * giao dịch mới nhất, xoá hợp đồng.
 */
export async function InstallmentDetailPage({ id, fullSchedule }: { id: string; fullSchedule: boolean }) {
  const principal = await requireSession();
  const contractId = z.uuid().safeParse(id);
  if (!contractId.success) notFound();
  const view = await getInstallmentDetail.execute(principal.shopId, contractId.data, fullSchedule);
  if (!view) notFound();
  const { contract, open, progress, reversible } = view;
  const isOwner = principal.role === "owner";

  return (
    <OperationStatus>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/tra-gop" className="hover:underline">
          Trả góp
        </Link>{" "}
        / {contract.code}
      </nav>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Hợp đồng {contract.code}</h1>
        {contract.deleted ? (
          <span className="badge badge-late">Đã xoá {formatDay(contract.deleted.on)}</span>
        ) : open ? (
          <DueBadge status={open.dueStatus} />
        ) : (
          <span className="badge badge-muted">Đã đóng{contract.closedOn && ` ${formatDay(contract.closedOn)}`}</span>
        )}
        {!contract.deleted && isOwner && (
          <div className="sm:ml-auto flex flex-wrap gap-2">
            <DeleteDialog
              contractId={contract.id}
              code={contract.code}
              disbursementText={formatSigned(contract.amountGiven)}
              paymentsLabel={view.paymentCount > 0 ? `Đảo ${view.paymentCount} lần thu` : null}
              paymentsText={formatSigned(contract.amountPaid.negate())}
              cashChangeText={formatSigned(contract.ledgerNet.negate())}
            />
          </div>
        )}
      </div>
      {contract.deleted && (
        <p className="mt-4 rounded-lg bg-red-50 text-red-800 px-4 py-3 text-sm">
          Hợp đồng đã xoá, mọi giao dịch đã được ghi bút toán đảo. Lý do: {contract.deleted.reason}
        </p>
      )}
      <OperationStatusMessage />

      {open && (
        <section className="card mt-6 p-4 flex flex-wrap gap-2" aria-label="Thao tác">
          <PayDialog
            contractId={contract.id}
            code={contract.code}
            expectedPaid={contract.amountPaid.toString()}
            choices={open.paymentOptions.map((o) => ({ index: o.index, dueText: formatDay(o.due), amountText: formatVnd(o.amount) }))}
          />
          <CloseDialog
            contractId={contract.id}
            code={contract.code}
            expectedPaid={contract.amountPaid.toString()}
            totalDueText={formatVnd(contract.totalDue)}
            paidText={formatVnd(contract.amountPaid)}
            remainingText={formatVnd(progress.remaining)}
          />
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Số liệu">
            <Stat label="Tổng phải thu" value={formatVnd(contract.totalDue)} />
            <Stat label="Đã thu" value={formatVnd(contract.amountPaid)} valueClass="text-emerald-700" />
            <Stat label="Còn phải thu" value={open ? formatVnd(progress.remaining) : "—"} />
            <div className="card p-4">
              <div className="text-sm text-slate-500">Tiến độ</div>
              <div className="mt-1 text-lg font-bold num">
                {progress.paidPeriods} / {progress.periods} kỳ
              </div>
              <ProgressBar paid={progress.paidPeriods} total={progress.periods} className="mt-2 w-full" />
            </div>
          </section>
          <Schedule view={view} />
          <History
            history={view.history}
            reverse={
              isOwner && reversible ? (
                <ReverseDialog
                  contractId={contract.id}
                  operationId={reversible.id}
                  label={OPERATION_LABEL[reversible.kind]}
                  when={`${formatDateTime(reversible.createdAt)} · ${reversible.createdByName}`}
                  amountText={reversible.cashNet.isZero() ? null : formatSigned(reversible.cashNet)}
                  effect={reverseEffect(reversible, contract.status === "closed")}
                />
              ) : null
            }
          />
        </div>

        <aside className="flex flex-col gap-6">
          <section className="card p-5" aria-labelledby="s-customer">
            <h2 id="s-customer" className="font-semibold">
              Khách hàng
            </h2>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm">
              <dt className="text-slate-500">Họ tên</dt>
              <dd className="font-medium">
                <Link href={`/khach-hang/${contract.customerId}`} className="text-teal-700 hover:underline">
                  {contract.customerName}
                </Link>
              </dd>
              <dt className="text-slate-500">Số CCCD</dt>
              <dd className="num">{contract.customer.cccdMasked ?? "—"}</dd>
              <dt className="text-slate-500">SĐT</dt>
              <dd className="num">{contract.customer.phone ?? "—"}</dd>
              <dt className="text-slate-500">Địa chỉ</dt>
              <dd>{contract.customer.address ?? "—"}</dd>
            </dl>
          </section>
          <section className="card p-5" aria-labelledby="s-loan">
            <h2 id="s-loan" className="font-semibold">
              Thông tin góp
            </h2>
            <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-3 text-sm">
              <dt className="text-slate-500">Tiền đưa khách</dt>
              <dd className="num font-medium">{formatVnd(contract.amountGiven)}</dd>
              <dt className="text-slate-500">Tổng phải thu</dt>
              <dd className="num">{formatVnd(contract.totalDue)}</dd>
              <dt className="text-slate-500">Tiền lời</dt>
              <dd className="num">{formatVnd(contract.totalDue.subtract(contract.amountGiven))}</dd>
              <dt className="text-slate-500">Số ngày góp</dt>
              <dd>
                {contract.totalDays} ngày ({formatDay(contract.startDate)} → {formatDay(view.end)})
              </dd>
              <dt className="text-slate-500">Mỗi kỳ</dt>
              <dd>
                {contract.periodDays} ngày · {formatVnd(view.perPeriod)} đ
              </dd>
              {contract.status === "closed" && contract.amountPaid.compare(contract.totalDue) < 0 && (
                <>
                  <dt className="text-slate-500">Giảm khi tất toán</dt>
                  <dd className="num">{formatVnd(contract.totalDue.subtract(contract.amountPaid))}</dd>
                </>
              )}
              <dt className="text-slate-500">KTV</dt>
              <dd>{contract.staffName}</dd>
              <dt className="text-slate-500">Ghi chú</dt>
              <dd>{contract.note ?? "—"}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </OperationStatus>
  );
}

function Stat({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold num ${valueClass}`}>{value}</div>
    </div>
  );
}

function Schedule({ view }: { view: InstallmentDetailView }) {
  const { contract } = view;
  const active = contract.status === "active" && !contract.deleted;
  return (
    <section className="card" aria-labelledby="t-schedule">
      <div className="p-5 pb-3 flex flex-wrap items-center gap-3">
        <h2 id="t-schedule" className="font-semibold">
          Lịch góp
        </h2>
        <span className="text-sm text-slate-500">
          Mỗi kỳ {contract.periodDays} ngày · {formatVnd(view.perPeriod)} đ
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Kỳ</th>
              <th>Ngày phải góp</th>
              <th className="text-right">Phải góp</th>
              <th className="text-right">Đã góp</th>
              <th>Ngày góp</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {view.schedule.map((p) => {
              const full = p.paid.equals(p.amount);
              const days = diffDays(view.today, p.due);
              const highlight = active && !full && days === 0 ? "bg-amber-50/50" : active && !full && days < 0 ? "bg-red-50/50" : undefined;
              return (
                <tr key={p.index} className={highlight}>
                  <td>{p.index}</td>
                  <td className="num">{formatDay(p.due)}</td>
                  <td className="text-right num">{formatVnd(p.amount)}</td>
                  <td className={`text-right num ${p.paid.isZero() ? "text-slate-400" : ""}`}>{formatVnd(p.paid)}</td>
                  <td className={p.paidOn ? "num" : "text-slate-400"}>{p.paidOn ? formatDay(p.paidOn) : "—"}</td>
                  <td>
                    {full ? (
                      <span className="badge badge-ok">Đã góp</span>
                    ) : !active ? (
                      <span className="badge badge-muted">{contract.deleted ? "—" : "Đã tất toán"}</span>
                    ) : days < 0 ? (
                      <span className="badge badge-late">Chậm</span>
                    ) : days === 0 ? (
                      <span className="badge badge-warn">Hôm nay</span>
                    ) : (
                      <span className="badge badge-muted">Chưa tới</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {view.scheduleTruncated && (
        <div className="p-4 text-sm">
          <Link href={{ pathname: `/tra-gop/${contract.id}`, query: { lich: "du" } }} className="text-teal-700 hover:underline">
            Xem đủ {view.progress.periods} kỳ
          </Link>
        </div>
      )}
    </section>
  );
}

function History({ history, reverse }: { history: HistoryLine[]; reverse: ReactNode }) {
  return (
    <section className="card" aria-labelledby="t-history">
      <div className="p-5 pb-3 flex flex-wrap items-center gap-2 justify-between">
        <h2 id="t-history" className="font-semibold">
          Lịch sử giao dịch
        </h2>
        {reverse}
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Nội dung</th>
              <th className="text-right">Thu</th>
              <th className="text-right">Chi</th>
              <th>Người thực hiện</th>
            </tr>
          </thead>
          <tbody>
            {history.map((t) => (
              <tr key={t.id} className={t.reversed ? "text-slate-400" : undefined}>
                <td className="num">{formatDateTime(t.occurredAt)}</td>
                <td>
                  {historyLabel(t)}
                  {t.reversed && <span className="badge badge-muted ml-2">Đã huỷ</span>}
                </td>
                <td className="text-right num text-emerald-700">{t.amount.isPositive() ? formatVnd(t.amount) : ""}</td>
                <td className="text-right num text-red-700">{t.amount.isNegative() ? formatVnd(t.amount.negate()) : ""}</td>
                <td>{t.createdByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
