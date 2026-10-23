import Link from "next/link";
import { z } from "zod";
import { getInstallmentStats, listInstallments, requireSession } from "@/composition-root";
import { normalizeCccd } from "@/modules/customer";
import { formatVnd } from "@/shared/kernel/vnd";
import type { InstallmentFilter, InstallmentStatusFilter } from "../application/ports";
import { DueBadge, ProgressBar, formatDay } from "./format";

// Khoá = giá trị tham số trên URL.
const STATUSES: Record<string, { label: string; value: InstallmentStatusFilter }> = {
  "dang-gop": { label: "Đang góp", value: "open" },
  "cham-gop": { label: "Chậm góp", value: "late" },
  "hom-nay": { label: "Đến hạn hôm nay", value: "due_today" },
  "da-dong": { label: "Đã đóng", value: "closed" },
  "da-xoa": { label: "Đã xoá", value: "deleted" },
};

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi; CCCD sai định dạng thì báo để người nhập sửa.
const querySchema = z.object({
  q: z.string().trim().max(100).nullable().catch(null),
  cccd: z.string().trim().max(30).nullable().catch(null),
  tt: z
    .enum(Object.keys(STATUSES) as [string, ...string[]])
    .nullable()
    .catch(null),
  sau: z.uuid().nullable().catch(null),
  moi: z
    .string()
    .regex(/^TG-\d{1,18}$/)
    .nullable()
    .catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

type Params = { q?: string; cccd?: string; tt?: string; sau?: string };

function listHref(params: Params) {
  const query = Object.fromEntries(Object.entries(params).filter(([, value]) => value));
  return { pathname: "/tra-gop", query };
}

/** Danh sách hợp đồng trả góp (mockup tra-gop.html): 4 ô thống kê của cả cửa hàng, tìm / lọc, tiến độ góp. */
export async function InstallmentListPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  const params = querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((key) => [key, first(query[key])])));
  const { moi, khach } = params;
  const q = params.q || null;
  const cccdText = params.cccd || null;
  const cccd = cccdText ? normalizeCccd(cccdText) : null;
  const filter: InstallmentFilter = { search: q, cccd, status: params.tt ? STATUSES[params.tt].value : null };
  // CCCD nhập sai định dạng: không tìm, không trả danh sách đầy đủ (người dùng tưởng là kết quả tìm).
  const invalidCccd = cccdText !== null && cccd === null;
  const [view, stats] = await Promise.all([
    invalidCccd ? null : listInstallments.execute(principal.shopId, filter, params.sau),
    getInstallmentStats.execute(principal.shopId),
  ]);
  const filtered = Boolean(q || cccdText || params.tt);
  const kept: Params = { q: q ?? undefined, cccd: cccdText ?? undefined, tt: params.tt ?? undefined };

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trả góp</h1>
          <p className="text-sm text-slate-500">{stats.openCount} hợp đồng đang góp</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/tra-gop/moi" className="btn btn-primary">
            + Thêm hợp đồng
          </Link>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Tóm tắt">
        <Stat label="Tiền đã đưa khách" value={formatVnd(stats.givenOpen)} />
        <Stat label="Còn phải thu" value={formatVnd(stats.remainingOpen)} />
        <Stat label="Đã thu tháng này" value={formatVnd(stats.collectedThisMonth)} valueClass="text-emerald-700" />
        <Stat label="Chậm góp" value={String(stats.lateCount)} valueClass="text-red-700" />
      </section>

      {moi && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
          Đã tạo hợp đồng {moi} và ghi giải ngân vào sổ quỹ.
          {khach && " Hợp đồng gắn với khách hàng đã có cùng số CCCD (thông tin khách cũ giữ nguyên)."}
        </p>
      )}

      <section className="card mt-6" aria-label="Danh sách hợp đồng">
        <form action="/tra-gop" className="p-4 flex flex-wrap gap-3 items-end border-b border-slate-200" role="search">
          <div className="field flex-1 min-w-[240px]">
            <label htmlFor="q">Tìm kiếm</label>
            <input id="q" name="q" defaultValue={q ?? ""} maxLength={100} className="input" placeholder="Mã HĐ, tên khách, SĐT" />
          </div>
          <div className="field w-full sm:w-52">
            <label htmlFor="cccd">Số CCCD (khớp đủ số)</label>
            <input
              id="cccd"
              name="cccd"
              defaultValue={cccdText ?? ""}
              inputMode="numeric"
              maxLength={30}
              className="input num"
              placeholder="0xxxxxxxxxxx"
              aria-invalid={invalidCccd || undefined}
              aria-describedby={invalidCccd ? "cccd-error" : undefined}
            />
          </div>
          <div className="field w-full sm:w-48">
            <label htmlFor="tt">Trạng thái</label>
            <select id="tt" name="tt" defaultValue={params.tt ?? ""} className="input">
              <option value="">Tất cả (chưa xoá)</option>
              {Object.entries(STATUSES).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-outline">
            Lọc
          </button>
          {filtered && (
            <Link href="/tra-gop" className="btn btn-outline">
              Bỏ lọc
            </Link>
          )}
        </form>

        {invalidCccd && (
          <p id="cccd-error" role="alert" className="p-5 text-sm text-red-700">
            Số CCCD phải đủ 12 số (hoặc CMND 9 số).
          </p>
        )}
        {view && view.items.length === 0 && (
          <p className="p-5 text-sm text-slate-500">{filtered ? "Không tìm thấy hợp đồng phù hợp." : "Chưa có hợp đồng nào."}</p>
        )}
        {view && view.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Mã HĐ</th>
                  <th>Khách hàng</th>
                  <th className="text-right">Tiền đưa khách</th>
                  <th className="text-right">Tổng phải thu</th>
                  <th className="text-right">Đã thu</th>
                  <th>Tiến độ</th>
                  <th className="text-right">Mỗi kỳ</th>
                  <th>Kỳ tới</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((c) => (
                  <tr key={c.id} className={c.deleted ? "text-slate-400" : undefined}>
                    <td className="font-medium">
                      <Link
                        href={`/tra-gop/${c.id}`}
                        className={c.deleted ? "line-through hover:underline" : "text-teal-700 hover:underline"}
                      >
                        {c.code}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/khach-hang/${c.customerId}`} className="font-medium hover:underline">
                        {c.customerName}
                      </Link>
                      {c.customerPhone && <div className="text-xs text-slate-500 num">{c.customerPhone}</div>}
                    </td>
                    <td className="text-right num">{formatVnd(c.amountGiven)}</td>
                    <td className="text-right num">{formatVnd(c.totalDue)}</td>
                    <td className="text-right num">{formatVnd(c.amountPaid)}</td>
                    <td>
                      <ProgressBar paid={c.progress.paidPeriods} total={c.progress.periods} />
                      <div className="text-xs text-slate-500 mt-1">
                        {c.progress.paidPeriods} / {c.progress.periods} kỳ
                      </div>
                    </td>
                    <td className="text-right num">{formatVnd(c.perPeriod)}</td>
                    <td>
                      {c.dueStatus && c.progress.next && <div className="num">{formatDay(c.progress.next.due)}</div>}
                      <div className={c.dueStatus && c.progress.next ? "mt-1" : ""}>
                        {c.deleted ? <span className="badge badge-late">Đã xoá</span> : <DueBadge status={c.dueStatus} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view?.nextAfter && (
          <div className="p-4">
            <Link href={listHref({ ...kept, sau: view.nextAfter })} className="btn btn-outline !h-9">
              Xem tiếp
            </Link>
          </div>
        )}
      </section>
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

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
