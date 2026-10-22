import Link from "next/link";
import { z } from "zod";
import { listCustomers, requireSession } from "@/composition-root";
import { normalizeCccd } from "@/modules/customer";
import { formatVnd } from "@/shared/kernel/vnd";
import type { CustomerFilter, CustomerQuery } from "../application/list-customers";

// Khoá = tham số `loc` trên URL.
const FILTERS: Record<string, { label: string; value: CustomerFilter }> = {
  "dang-mo": { label: "Đang có hợp đồng mở", value: "open" },
  "qua-han": { label: "Có hợp đồng quá hạn", value: "overdue" },
};

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi; CCCD sai định dạng thì báo để người nhập sửa.
const querySchema = z.object({
  q: z.string().trim().max(100).nullable().catch(null),
  cccd: z.string().trim().max(30).nullable().catch(null),
  loc: z
    .enum(Object.keys(FILTERS) as [string, ...string[]])
    .nullable()
    .catch(null),
  sau: z.uuid().nullable().catch(null),
});

type Params = { q?: string; cccd?: string; loc?: string; sau?: string };

function customerHref(params: Params) {
  const query = Object.fromEntries(Object.entries(params).filter(([, value]) => value));
  return { pathname: "/khach-hang", query };
}

/** "2026-10-05" → "05/10/2026". */
const formatDay = (date: string) => date.split("-").reverse().join("/");

export async function CustomerListPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  const params = querySchema.parse({ q: first(query.q), cccd: first(query.cccd), loc: first(query.loc), sau: first(query.sau) });
  const q = params.q || null;
  const cccdText = params.cccd || null;
  const cccd = cccdText ? normalizeCccd(cccdText) : null;
  const filter = params.loc ? FILTERS[params.loc].value : null;
  const search: CustomerQuery = { search: q, cccd, filter };
  // CCCD nhập sai định dạng: không tìm, không trả danh sách đầy đủ (người dùng tưởng là kết quả tìm).
  const invalidCccd = cccdText !== null && cccd === null;
  const view = invalidCccd ? null : await listCustomers.execute(principal.shopId, search, params.sau);
  const filtered = Boolean(q || cccdText || filter);
  const kept: Params = { q: q ?? undefined, cccd: cccdText ?? undefined, loc: params.loc ?? undefined };

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Khách hàng</h1>
          {view && (
            <p className="text-sm text-slate-500">
              {view.totals.customers} khách hàng · {view.totals.withOpenContracts} khách đang có hợp đồng mở
            </p>
          )}
        </div>
      </div>

      <section className="card mt-6" aria-label="Danh sách khách hàng">
        <form action="/khach-hang" className="p-4 flex flex-wrap gap-3 items-end border-b border-slate-200" role="search">
          <div className="field flex-1 min-w-[240px]">
            <label htmlFor="q">Tìm kiếm</label>
            <input
              id="q"
              name="q"
              defaultValue={q ?? ""}
              maxLength={100}
              className="input"
              placeholder="Tên khách (gõ không dấu được), SĐT"
            />
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
          <div className="field w-full sm:w-52">
            <label htmlFor="loc">Lọc</label>
            <select id="loc" name="loc" defaultValue={params.loc ?? ""} className="input">
              <option value="">Tất cả</option>
              {Object.entries(FILTERS).map(([key, { label }]) => (
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
            <Link href="/khach-hang" className="btn btn-outline">
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
          <p className="p-5 text-sm text-slate-500">{filtered ? "Không tìm thấy khách hàng phù hợp." : "Chưa có khách hàng nào."}</p>
        )}
        {view && view.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Số CCCD</th>
                  <th>Địa chỉ</th>
                  <th className="text-right">HĐ đang mở</th>
                  <th className="text-right">Dư nợ hiện tại</th>
                  <th>Giao dịch gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="font-medium">{c.fullName}</div>
                      {c.phone && <div className="text-xs text-slate-500 num">{c.phone}</div>}
                    </td>
                    <td className={c.cccdMasked ? "num" : "text-slate-400"}>{c.cccdMasked ?? "Chưa có"}</td>
                    <td className="max-w-[220px] truncate">{c.address ?? <span className="text-slate-400">—</span>}</td>
                    <td className={`text-right num ${c.openContracts === 0 ? "text-slate-400" : ""}`}>
                      {c.openContracts}
                      {c.overdueContracts > 0 && <span className="badge badge-late ml-1">{c.overdueContracts} quá hạn</span>}
                    </td>
                    <td className={`text-right num ${c.debt.isZero() ? "text-slate-400" : ""}`}>{formatVnd(c.debt)}</td>
                    <td className="num">{c.lastActivity ? formatDay(c.lastActivity) : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view?.nextAfter && (
          <div className="p-4">
            <Link href={customerHref({ ...kept, sau: view.nextAfter })} className="btn btn-outline !h-9">
              Xem tiếp
            </Link>
          </div>
        )}
      </section>
      <p className="mt-3 text-xs text-slate-500">
        Khách hàng được tạo khi lập hợp đồng. Số CCCD chỉ hiện 4 số cuối; tìm theo CCCD phải nhập đủ số. Số liệu hợp đồng chưa tính trả góp.
      </p>
    </>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
