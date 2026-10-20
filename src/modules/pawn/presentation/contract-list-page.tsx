import Link from "next/link";
import { z } from "zod";
import { listContracts, requireSession } from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import type { InterestType } from "../application/preview";

const INTEREST_UNIT: Record<InterestType, string> = {
  per_million_per_day: "k/triệu/ngày",
  percent_per_month: "%/tháng",
  percent_per_week: "%/tuần",
};

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi.
const querySchema = z.object({
  sau: z.uuid().nullable().catch(null),
  moi: z.string().regex(/^(CD|TC)-\d{1,18}$/).nullable().catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

const formatDay = (date: string) => date.split("-").reverse().join("/");

export async function ContractListPage({ query }: { query: Record<string, string | string[] | undefined> }) {
  const principal = await requireSession();
  const { sau, moi, khach } = querySchema.parse({ sau: first(query.sau), moi: first(query.moi), khach: first(query.khach) });
  const view = await listContracts.execute(principal.shopId, sau);

  return (
    <div className="flex flex-col gap-4">
      {moi && (
        <p role="status" className="rounded-lg border bg-muted px-4 py-2 text-sm">
          Đã tạo hợp đồng {moi} và ghi giải ngân vào sổ quỹ.
          {khach && " Hợp đồng gắn với khách hàng đã có cùng số CCCD (thông tin khách cũ giữ nguyên)."}
        </p>
      )}
      {view.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có hợp đồng nào.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Mã HĐ</th>
                <th className="py-2 pr-3 font-medium">Khách hàng</th>
                <th className="py-2 pr-3 font-medium">Loại</th>
                <th className="py-2 pr-3 font-medium">Tài sản</th>
                <th className="py-2 pr-3 text-right font-medium">Tiền vay</th>
                <th className="py-2 pr-3 font-medium">Ngày vay</th>
                <th className="py-2 pr-3 font-medium">Hình thức lãi</th>
                <th className="py-2 pr-3 text-right font-medium">Lãi đến hôm nay</th>
                <th className="py-2 font-medium">Hạn đóng lãi</th>
              </tr>
            </thead>
            <tbody>
              {view.items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2 pr-3 font-medium">{c.code}</td>
                  <td className="py-2 pr-3">
                    {c.customerName}
                    {c.customerPhone && <span className="block text-xs text-muted-foreground">{c.customerPhone}</span>}
                  </td>
                  <td className="py-2 pr-3">{c.kind === "secured" ? "Thế chấp" : "Tín chấp"}</td>
                  <td className="py-2 pr-3">{c.assetName ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatVnd(c.principal)}</td>
                  <td className="py-2 pr-3">{formatDay(c.loanDate)}</td>
                  <td className="py-2 pr-3">
                    {c.rateText.replace(".", ",")} {INTEREST_UNIT[c.interestType]}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c.accruedInterest ? formatVnd(c.accruedInterest) : "—"}</td>
                  <td className={`py-2 ${c.nextInterestDue && c.nextInterestDue < view.today ? "text-destructive" : ""}`}>
                    {c.nextInterestDue ? formatDay(c.nextInterestDue) : "Đã đóng"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.nextAfter && (
        <Link href={{ pathname: "/cam-do", query: { sau: view.nextAfter } }} className="text-sm underline underline-offset-4">
          Xem tiếp
        </Link>
      )}
    </div>
  );
}

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}
