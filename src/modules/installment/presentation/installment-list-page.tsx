import Link from "next/link";
import { z } from "zod";
import { listInstallments, requireSession } from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import { DueBadge, ProgressBar, formatDay } from "./format";

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi.
const querySchema = z.object({
  sau: z.uuid().nullable().catch(null),
  moi: z
    .string()
    .regex(/^TG-\d{1,18}$/)
    .nullable()
    .catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

/** Danh sách hợp đồng trả góp (mockup tra-gop.html). */
export async function InstallmentListPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  const params = querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((key) => [key, first(query[key])])));
  const { moi, khach } = params;
  const view = await listInstallments.execute(principal.shopId, params.sau);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Trả góp</h1>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/tra-gop/moi" className="btn btn-primary">
            + Thêm hợp đồng
          </Link>
        </div>
      </div>

      {moi && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
          Đã tạo hợp đồng {moi} và ghi giải ngân vào sổ quỹ.
          {khach && " Hợp đồng gắn với khách hàng đã có cùng số CCCD (thông tin khách cũ giữ nguyên)."}
        </p>
      )}

      <section className="card mt-6" aria-label="Danh sách hợp đồng">
        {view.items.length === 0 && <p className="p-5 text-sm text-slate-500">Chưa có hợp đồng nào.</p>}
        {view.items.length > 0 && (
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
                  <tr key={c.id}>
                    <td className="font-medium">{c.code}</td>
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
                        <DueBadge status={c.dueStatus} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.nextAfter && (
          <div className="p-4">
            <Link href={{ pathname: "/tra-gop", query: { sau: view.nextAfter } }} className="btn btn-outline !h-9">
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
