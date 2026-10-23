import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCustomerDetail, requireSession } from "@/composition-root";
import { CccdReveal, EditCustomerDialog } from "@/modules/customer";
import { CONTRACT_CASH_LABEL, DueBadge } from "@/modules/pawn";
import { BUSINESS_TIME_ZONE, businessDate } from "@/shared/kernel/local-date";
import { formatVnd } from "@/shared/kernel/vnd";
import type {
  CustomerCashType,
  CustomerDetailView,
  CustomerInstallmentRow,
  CustomerPawnRow,
  CustomerTransactionRow,
} from "../application/get-customer-detail";

const CASH_LABEL: Record<CustomerCashType, string> = {
  ...CONTRACT_CASH_LABEL,
  installment_disbursement: "Giải ngân trả góp",
  installment_payment: "Thu trả góp",
};

/** "2026-10-05" → "05/10/2026". */
const formatDay = (date: string) => date.split("-").reverse().join("/");

const formatTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: BUSINESS_TIME_ZONE,
  timeStyle: "short",
}).format;

/** "05/10/2026 10:15" theo giờ Việt Nam, như mockup. */
const formatDateTime = (at: Date) =>
  `${formatDay(businessDate(at))} ${formatTime(at)}`;

/**
 * Trang chi tiết khách hàng (mockup khach-hang-chi-tiet.html). Sửa thông tin và xem CCCD đầy đủ thuộc module customer;
 * nút "+ Cầm đồ / Tín chấp", "+ Trả góp" mở form tạo hợp đồng điền sẵn khách này. Số liệu gồm cả trả góp.
 */
export async function CustomerDetailPage({ id }: { id: string }) {
  const principal = await requireSession();
  const customerId = z.uuid().safeParse(id);
  if (!customerId.success) notFound();
  const view = await getCustomerDetail.execute(
    principal.shopId,
    customerId.data,
  );
  if (!view) notFound();
  const { customer } = view;

  return (
    <>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/khach-hang" className="hover:underline">
          Khách hàng
        </Link>{" "}
        / {customer.fullName}
      </nav>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{customer.fullName}</h1>
        {customer.overdueContracts > 0 && (
          <span className="badge badge-late">
            {customer.overdueContracts} hợp đồng quá hạn
          </span>
        )}
        <div className="sm:ml-auto flex flex-wrap items-center gap-2">
          <EditCustomerDialog
            customerId={customer.id}
            info={{
              fullName: customer.fullName,
              phone: customer.phone,
              address: customer.address,
              cccdMasked: customer.cccdMasked,
            }}
          />
          <Link
            href={`/cam-do/moi?khach=${customer.id}`}
            className="btn btn-outline"
          >
            + Cầm đồ / Tín chấp
          </Link>
          <Link
            href={`/tra-gop/moi?khach=${customer.id}`}
            className="btn btn-primary"
          >
            + Trả góp
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <section
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
            aria-label="Số liệu"
          >
            <Stat label="HĐ đang mở" value={String(customer.openContracts)} />
            <Stat label="Dư nợ hiện tại" value={formatVnd(customer.debt)} />
            <Stat
              label="Tổng lãi đã đóng"
              value={formatVnd(customer.interestPaid)}
              valueClass="text-emerald-700"
            />
            {/* "2026-03-14" → "03/2026". */}
            <Stat
              label="Khách từ"
              value={view.since.slice(0, 7).split("-").reverse().join("/")}
            />
          </section>
          <Contracts view={view} />
          <Transactions transactions={view.transactions} />
        </div>

        <aside className="flex flex-col gap-6">
          <section className="card p-5" aria-labelledby="s-customer">
            <h2 id="s-customer" className="font-semibold">
              Thông tin khách
            </h2>
            <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-3 text-sm">
              <dt className="text-slate-500">Họ tên</dt>
              <dd className="font-medium">{customer.fullName}</dd>
              <dt className="text-slate-500">Số CCCD</dt>
              <dd>
                {customer.cccdMasked ? (
                  // Đổi CCCD thì key đổi, bỏ số đầy đủ đang hiện.
                  <CccdReveal
                    key={customer.cccdMasked}
                    customerId={customer.id}
                    masked={customer.cccdMasked}
                    canReveal={principal.role === "owner"}
                  />
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-slate-500">SĐT</dt>
              <dd className="num">{customer.phone ?? "—"}</dd>
              <dt className="text-slate-500">Địa chỉ</dt>
              <dd>{customer.address ?? "—"}</dd>
            </dl>
          </section>
        </aside>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Dư nợ = gốc còn lại cầm đồ/tín chấp + trả góp còn phải thu. Tổng lãi
        chỉ tính cầm đồ/tín chấp.
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-bold num ${valueClass}`}>{value}</div>
    </div>
  );
}

function Contracts({ view }: { view: CustomerDetailView }) {
  return (
    <section className="card" aria-labelledby="t-contracts">
      <h2 id="t-contracts" className="p-5 pb-3 font-semibold">
        Hợp đồng của khách
      </h2>
      {view.contracts.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">
          Khách chưa có hợp đồng nào.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Mã HĐ</th>
                <th>Loại</th>
                <th>Tài sản</th>
                <th className="text-right">Tiền vay</th>
                <th className="text-right">Còn lại</th>
                <th>Ngày vay</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {view.contracts.map((c) =>
                c.type === "pawn" ? (
                  <ContractRow key={c.id} contract={c} today={view.today} />
                ) : (
                  <InstallmentRow key={c.id} contract={c} />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContractRow({
  contract: c,
  today,
}: {
  contract: CustomerPawnRow;
  today: string;
}) {
  // Hợp đồng đã xoá: gạch ngang, mờ như mockup; vẫn mở được trang chi tiết (xem lý do xoá).
  return (
    <tr className={c.deleted ? "text-slate-400" : undefined}>
      <td>
        <Link
          href={`/cam-do/${c.id}`}
          className={
            c.deleted
              ? "line-through hover:underline"
              : "text-teal-700 font-medium hover:underline"
          }
        >
          {c.code}
        </Link>
      </td>
      <td>{c.kind === "secured" ? "Thế chấp" : "Tín chấp"}</td>
      <td>{c.assetName ?? <span className="text-slate-400">—</span>}</td>
      <td className="text-right num">{formatVnd(c.principal)}</td>
      <td
        className={`text-right num ${c.outstandingPrincipal.isZero() ? "text-slate-400" : ""}`}
      >
        {formatVnd(c.outstandingPrincipal)}
      </td>
      <td className="num">{formatDay(c.loanDate)}</td>
      <td>
        {c.deleted ? (
          <span className="badge badge-late">Đã xoá</span>
        ) : (
          <DueBadge
            due={c.nextInterestDue}
            today={today}
            kind={c.kind}
            closedOn={c.closedOn}
          />
        )}
      </td>
    </tr>
  );
}

function InstallmentRow({ contract: c }: { contract: CustomerInstallmentRow }) {
  return (
    <tr className={c.deleted ? "text-slate-400" : undefined}>
      <td>
        <Link
          href={`/tra-gop/${c.id}`}
          className={
            c.deleted
              ? "line-through hover:underline"
              : "text-teal-700 font-medium hover:underline"
          }
        >
          {c.code}
        </Link>
      </td>
      <td>Trả góp</td>
      <td>
        <span className="text-slate-400">—</span>
      </td>
      <td className="text-right num">{formatVnd(c.amountGiven)}</td>
      <td
        className={`text-right num ${c.remaining.isZero() ? "text-slate-400" : ""}`}
      >
        {formatVnd(c.remaining)}
      </td>
      <td className="num">{formatDay(c.startDate)}</td>
      <td>
        <InstallmentBadge contract={c} />
      </td>
    </tr>
  );
}

function InstallmentBadge({ contract: c }: { contract: CustomerInstallmentRow }) {
  if (c.deleted) return <span className="badge badge-late">Đã xoá</span>;
  switch (c.dueStatus) {
    case "late":
      return <span className="badge badge-late">Chậm góp</span>;
    case "today":
      return <span className="badge badge-warn">Hôm nay</span>;
    case "on_time":
      return <span className="badge badge-ok">Đang góp</span>;
    default:
      return (
        <span className="badge badge-muted">
          {c.closedOn ? `Đã đóng ${formatDay(c.closedOn)}` : "Đã đóng"}
        </span>
      );
  }
}

function Transactions({
  transactions,
}: {
  transactions: CustomerTransactionRow[];
}) {
  return (
    <section className="card" aria-labelledby="t-history">
      <h2 id="t-history" className="p-5 pb-3 font-semibold">
        Giao dịch gần đây
      </h2>
      {transactions.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">
          Chưa có giao dịch nào.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Hợp đồng</th>
                <th>Nội dung</th>
                <th className="text-right">Thu</th>
                <th className="text-right">Chi</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr
                  key={t.id}
                  className={t.reversed ? "text-slate-400" : undefined}
                >
                  <td className="num">{formatDateTime(t.occurredAt)}</td>
                  <td>{t.contractCode}</td>
                  <td>
                    {CASH_LABEL[t.type]}
                    {t.periodFrom &&
                      t.periodTo &&
                      ` ${formatDay(t.periodFrom)} – ${formatDay(t.periodTo)}`}
                    {t.type === "reversal" && t.note && ` — ${t.note}`}
                    {t.reversed && (
                      <span className="badge badge-muted ml-2">Đã huỷ</span>
                    )}
                  </td>
                  <td className="text-right num text-emerald-700">
                    {t.amount.isPositive() ? formatVnd(t.amount) : ""}
                  </td>
                  <td className="text-right num text-red-700">
                    {t.amount.isNegative() ? formatVnd(t.amount.negate()) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
