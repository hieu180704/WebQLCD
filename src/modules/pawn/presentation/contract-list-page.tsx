import Link from "next/link";
import { z } from "zod";
import { listContracts, requireSession } from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import { DueBadge, INTEREST_UNIT, formatDay } from "./format";

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi.
const querySchema = z.object({
  sau: z.uuid().nullable().catch(null),
  moi: z.string().regex(/^(CD|TC)-\d{1,18}$/).nullable().catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

export async function ContractListPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  const { sau, moi, khach } = querySchema.parse({ sau: first(query.sau), moi: first(query.moi), khach: first(query.khach) });
  const view = await listContracts.execute(principal.shopId, sau);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold">Cầm đồ & Tín chấp</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/cam-do/moi" className="btn btn-primary">
            + Thêm hồ sơ
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
        {view.items.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Chưa có hợp đồng nào.</p>
        ) : (
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
                  <tr key={c.id}>
                    <td className="font-medium">
                      <Link href={`/cam-do/${c.id}`} className="text-teal-700 hover:underline">
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
                        <DueBadge due={c.nextInterestDue} today={view.today} kind={c.kind} />
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
            <Link href={{ pathname: "/cam-do", query: { sau: view.nextAfter } }} className="btn btn-outline !h-9">
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
