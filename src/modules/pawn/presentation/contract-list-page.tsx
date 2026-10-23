import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { listContracts, requireSession } from "@/composition-root";
import { normalizeCccd } from "@/modules/customer";
import { formatVnd } from "@/shared/kernel/vnd";
import type { ContractFilter, ContractStatusFilter } from "../application/ports";
import { DueBadge, INTEREST_UNIT, formatDay } from "./format";

// Khoá = giá trị tham số trên URL (trang chủ trỏ vào `tt=qua-han`, `tt=sap-den-han`).
const KINDS: Record<string, { label: string; value: NonNullable<ContractFilter["kind"]> }> = {
  "the-chap": { label: "Thế chấp (cầm đồ)", value: "secured" },
  "tin-chap": { label: "Tín chấp", value: "unsecured" },
};
const STATUSES: Record<string, { label: string; value: ContractStatusFilter }> = {
  "dang-mo": { label: "Đang mở", value: "open" },
  "qua-han": { label: "Quá hạn", value: "overdue" },
  "hom-nay": { label: "Đến hạn hôm nay", value: "due_today" },
  "sap-den-han": { label: "Đến hạn trong 3 ngày (gồm quá hạn)", value: "due_soon" },
  "da-dong": { label: "Đã chuộc / Đã đóng", value: "closed" },
  "da-xoa": { label: "Đã xoá", value: "deleted" },
};

const keyOf = (record: Record<string, unknown>) =>
  z
    .enum(Object.keys(record) as [string, ...string[]])
    .nullable()
    .catch(null);

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi; CCCD sai định dạng thì báo để người nhập sửa.
const querySchema = z.object({
  q: z.string().trim().max(100).nullable().catch(null),
  cccd: z.string().trim().max(30).nullable().catch(null),
  loai: keyOf(KINDS),
  tt: keyOf(STATUSES),
  sau: z.uuid().nullable().catch(null),
  moi: z.string().regex(/^(CD|TC)-\d{1,18}$/).nullable().catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

type Params = { q?: string; cccd?: string; loai?: string; tt?: string; sau?: string };

function contractHref(params: Params) {
  const query = Object.fromEntries(Object.entries(params).filter(([, value]) => value));
  return { pathname: "/cam-do", query };
}

/** `summary` (dưới tiêu đề) và `stats` (dưới hàng tiêu đề) do route ghép từ module reporting. */
export async function ContractListPage({
  query,
  summary,
  stats,
}: {
  query: Record<string, string | string[] | undefined>;
  summary?: ReactNode;
  stats?: ReactNode;
}) {
  const principal = await requireSession();
  const params = querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((key) => [key, first(query[key])])));
  const { moi, khach } = params;
  const q = params.q || null;
  const cccdText = params.cccd || null;
  const cccd = cccdText ? normalizeCccd(cccdText) : null;
  const filter: ContractFilter = {
    search: q,
    cccd,
    kind: params.loai ? KINDS[params.loai].value : null,
    status: params.tt ? STATUSES[params.tt].value : null,
  };
  // CCCD nhập sai định dạng: không tìm, không trả danh sách đầy đủ (người dùng tưởng là kết quả tìm).
  const invalidCccd = cccdText !== null && cccd === null;
  const view = invalidCccd ? null : await listContracts.execute(principal.shopId, filter, params.sau);
  const filtered = Boolean(q || cccdText || params.loai || params.tt);
  const kept: Params = { q: q ?? undefined, cccd: cccdText ?? undefined, loai: params.loai ?? undefined, tt: params.tt ?? undefined };

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cầm đồ & Tín chấp</h1>
          {summary && <p className="text-sm text-slate-500">{summary}</p>}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/cam-do/moi" className="btn btn-primary">
            + Thêm hồ sơ
          </Link>
        </div>
      </div>
      {stats}

      {moi && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
          Đã tạo hợp đồng {moi} và ghi giải ngân vào sổ quỹ.
          {khach && " Hợp đồng gắn với khách hàng đã có cùng số CCCD (thông tin khách cũ giữ nguyên)."}
        </p>
      )}

      <section className="card mt-6" aria-label="Danh sách hợp đồng">
        <form action="/cam-do" className="p-4 flex flex-wrap gap-3 items-end border-b border-slate-200" role="search">
          <div className="field flex-1 min-w-[240px]">
            <label htmlFor="q">Tìm kiếm</label>
            <input
              id="q"
              name="q"
              defaultValue={q ?? ""}
              maxLength={100}
              className="input"
              placeholder="Mã HĐ, tên khách, SĐT, tên tài sản"
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
          <div className="field w-[calc(50%-6px)] sm:w-44">
            <label htmlFor="loai">Loại</label>
            <select id="loai" name="loai" defaultValue={params.loai ?? ""} className="input">
              <option value="">Tất cả</option>
              {Object.entries(KINDS).map(([key, { label }]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field w-[calc(50%-6px)] sm:w-56">
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
            <Link href="/cam-do" className="btn btn-outline">
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
                  <th>Loại</th>
                  <th>Tài sản</th>
                  <th className="text-right">Tiền vay</th>
                  <th>Ngày vay</th>
                  <th>Hình thức lãi</th>
                  <th className="text-right">Lãi đến hôm nay</th>
                  <th>Hạn đóng lãi</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((c) => (
                  <tr key={c.id} className={c.deleted ? "text-slate-400" : undefined}>
                    <td className="font-medium">
                      <Link href={`/cam-do/${c.id}`} className={c.deleted ? "line-through hover:underline" : "text-teal-700 hover:underline"}>
                        {c.code}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/khach-hang/${c.customerId}`} className="font-medium hover:underline">
                        {c.customerName}
                      </Link>
                      {c.customerPhone && <div className="text-xs text-slate-500 num">{c.customerPhone}</div>}
                    </td>
                    <td>{c.kind === "secured" ? "Thế chấp" : "Tín chấp"}</td>
                    <td>{c.assetName ?? <span className="text-slate-400">—</span>}</td>
                    <td className="text-right num">{formatVnd(c.principal)}</td>
                    <td className="num">{formatDay(c.loanDate)}</td>
                    <td>
                      {c.rateText.replace(".", ",")} {INTEREST_UNIT[c.interestType]}
                    </td>
                    <td className="text-right num">{c.accruedInterest ? formatVnd(c.accruedInterest) : "—"}</td>
                    <td>
                      {c.nextInterestDue && <div className="num">{formatDay(c.nextInterestDue)}</div>}
                      <div className={c.nextInterestDue ? "mt-1" : ""}>
                        {c.deleted ? (
                          <span className="badge badge-late">Đã xoá</span>
                        ) : (
                          <DueBadge due={c.nextInterestDue} today={view.today} kind={c.kind} />
                        )}
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
            <Link href={contractHref({ ...kept, sau: view.nextAfter })} className="btn btn-outline !h-9">
              Xem tiếp
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
