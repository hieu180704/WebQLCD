import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getContractDetail, requireSession } from "@/composition-root";
import { BUSINESS_TIME_ZONE, businessDate, diffDays } from "@/shared/kernel/local-date";
import { formatVnd } from "@/shared/kernel/vnd";
import type { ContractDetailView } from "../application/get-contract-detail";
import type { ContractCashType, ContractTransaction } from "../application/ports";
import { ExtendDialog } from "./extend-dialog";
import { DueBadge, INTEREST_UNIT, formatDay } from "./format";
import { OperationStatus } from "./operation-status";
import { PayInterestDialog } from "./pay-interest-dialog";
import { PrincipalDialog } from "./principal-dialog";
import { RedeemDialog } from "./redeem-dialog";

const TYPE_LABEL: Record<ContractCashType, string> = {
  disbursement: "Giải ngân, tạo hợp đồng",
  additional_loan: "Vay thêm",
  interest_payment: "Đóng lãi",
  principal_repayment: "Trả gốc",
  reversal: "Huỷ giao dịch",
};

const formatTime = new Intl.DateTimeFormat("vi-VN", { timeZone: BUSINESS_TIME_ZONE, timeStyle: "short" }).format;

/** "05/10/2026 10:15" theo giờ Việt Nam, như mockup. */
const formatDateTime = (at: Date) => `${formatDay(businessDate(at))} ${formatTime(at)}`;

/** Trang chi tiết hợp đồng cầm đồ/tín chấp (mockup cam-do-chi-tiet.html). Thao tác: đóng lãi, trả bớt gốc, vay thêm, gia hạn, chuộc đồ / đóng hợp đồng. */
export async function ContractDetailPage({ id }: { id: string }) {
  const principal = await requireSession();
  const contractId = z.uuid().safeParse(id);
  if (!contractId.success) notFound();
  const view = await getContractDetail.execute(principal.shopId, contractId.data);
  if (!view) notFound();
  const { contract, open } = view;
  const interestDays = Math.max(0, diffDays(contract.interestPaidUntil, view.today));
  const lock = {
    contractId: contract.id,
    code: contract.code,
    expectedPaidUntil: contract.interestPaidUntil,
    asOf: view.today,
    outstanding: contract.outstandingPrincipal.toString(),
  };

  return (
    <>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/cam-do" className="hover:underline">
          Cầm đồ & Tín chấp
        </Link>{" "}
        / {contract.code}
      </nav>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Hợp đồng {contract.code}</h1>
        <DueBadge due={open?.nextInterestDue ?? null} today={view.today} kind={contract.kind} closedOn={contract.closedOn} />
      </div>

      {open && (
        <section className="card mt-6 p-4 flex flex-wrap gap-2" aria-label="Thao tác">
          <OperationStatus>
            <PayInterestDialog
              contractId={contract.id}
              code={contract.code}
              expectedPaidUntil={contract.interestPaidUntil}
              choices={open.interestOptions.map((option, i) => ({
                periods: i + 1,
                toText: formatDay(option.to),
                amountText: formatVnd(option.amount),
              }))}
            />
            {(["repayment", "additional_loan"] as const).map((direction) => (
              <PrincipalDialog
                key={direction}
                direction={direction}
                {...lock}
                interestDue={open.accruedInterest.toString()}
                interestDays={interestDays}
                aheadDays={Math.max(0, diffDays(view.today, contract.interestPaidUntil))}
                interestType={contract.interestType}
                rate={contract.interestRate.toString()}
              />
            ))}
            <ExtendDialog
              {...lock}
              loanDate={contract.loanDate}
              termDays={contract.termDays}
              defaultDays={contract.interestPeriodDays}
              interestDue={open.accruedInterest.toString()}
              interestDays={interestDays}
            />
            <RedeemDialog
              {...lock}
              title={contract.kind === "secured" ? "Chuộc đồ" : "Đóng hợp đồng"}
              interestDue={open.accruedInterest.toString()}
              interestDays={interestDays}
            />
          </OperationStatus>
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Số liệu">
            <Stat label="Tiền gốc còn lại" value={formatVnd(contract.outstandingPrincipal)} />
            <Stat label="Lãi đã đóng" value={formatVnd(contract.interestPaid)} valueClass="text-emerald-700" />
            <Stat label="Lãi đến hôm nay" value={open ? formatVnd(open.accruedInterest) : "—"} valueClass="text-red-700" />
            <Stat label="Cần trả nếu chuộc" value={open ? formatVnd(open.payoff) : "—"} />
          </section>
          <Schedule view={view} />
          <History history={view.history} />
        </div>

        <aside className="flex flex-col gap-6">
          <section className="card p-5" aria-labelledby="s-customer">
            <h2 id="s-customer" className="font-semibold">
              Khách hàng
            </h2>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm">
              <dt className="text-slate-500">Họ tên</dt>
              <dd className="font-medium">{contract.customerName}</dd>
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
              Khoản vay
            </h2>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm">
              <dt className="text-slate-500">Loại</dt>
              <dd>{contract.kind === "secured" ? "Thế chấp (cầm đồ)" : "Tín chấp"}</dd>
              <dt className="text-slate-500">Tài sản</dt>
              <dd>{contract.assetName ?? "—"}</dd>
              <dt className="text-slate-500">Tiền vay</dt>
              <dd className="num font-medium">{formatVnd(contract.principal)}</dd>
              <dt className="text-slate-500">Hình thức lãi</dt>
              <dd>
                {view.rateText.replace(".", ",")} {INTEREST_UNIT[contract.interestType]}
                {contract.prepaidInterest && ", thu lãi trước"}
              </dd>
              <dt className="text-slate-500">Kỳ lãi</dt>
              <dd>{contract.interestPeriodDays} ngày</dd>
              <dt className="text-slate-500">Ngày vay</dt>
              <dd className="num">{formatDay(contract.loanDate)}</dd>
              <dt className="text-slate-500">Số ngày vay</dt>
              <dd>
                {contract.termDays} ngày (đến {formatDay(view.termEnd)})
              </dd>
              <dt className="text-slate-500">Lãi đã trả đến</dt>
              <dd className="num">{formatDay(contract.interestPaidUntil)}</dd>
              <dt className="text-slate-500">KTV</dt>
              <dd>{contract.staffName}</dd>
              <dt className="text-slate-500">Ghi chú</dt>
              <dd>{contract.note ?? "—"}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
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

/** Kỳ đã đóng (từ sổ két, cũ trước) rồi các kỳ chưa đóng (tính trên gốc còn lại). */
function Schedule({ view }: { view: ContractDetailView }) {
  const paid = view.history.filter((t) => t.type === "interest_payment" && !t.reversed).reverse();
  const upcoming = view.open?.schedule ?? [];
  return (
    <section className="card" aria-labelledby="t-schedule">
      <h2 id="t-schedule" className="p-5 pb-3 font-semibold">
        Lịch đóng lãi
      </h2>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Từ ngày</th>
              <th>Đến ngày</th>
              <th className="text-right">Tiền lãi</th>
              <th>Hạn / ngày đóng</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {paid.map((t) => (
              <tr key={t.id}>
                <td className="num">{t.periodFrom && formatDay(t.periodFrom)}</td>
                <td className="num">{t.periodTo && formatDay(t.periodTo)}</td>
                <td className="text-right num">{formatVnd(t.amount)}</td>
                <td className="num">{formatDay(businessDate(t.occurredAt))}</td>
                <td>
                  <span className="badge badge-ok">Đã đóng</span>
                </td>
              </tr>
            ))}
            {upcoming.map((p) => {
              const days = diffDays(view.today, p.due);
              return (
                <tr key={p.from} className={days < 0 ? "bg-red-50/50" : undefined}>
                  <td className="num">{formatDay(p.from)}</td>
                  <td className="num">{formatDay(p.to)}</td>
                  <td className="text-right num">{formatVnd(p.amount)}</td>
                  <td className="num">{formatDay(p.due)}</td>
                  <td>
                    {days < 0 ? (
                      <span className="badge badge-late">Quá hạn</span>
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
    </section>
  );
}

function History({ history }: { history: ContractTransaction[] }) {
  return (
    <section className="card" aria-labelledby="t-history">
      <h2 id="t-history" className="p-5 pb-3 font-semibold">
        Lịch sử giao dịch
      </h2>
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
                  {TYPE_LABEL[t.type]}
                  {t.periodFrom && t.periodTo && ` ${formatDay(t.periodFrom)} – ${formatDay(t.periodTo)}`}
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
