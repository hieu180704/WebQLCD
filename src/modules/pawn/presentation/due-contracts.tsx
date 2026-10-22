import Link from "next/link";
import { diffDays } from "@/shared/kernel/local-date";
import { formatVnd } from "@/shared/kernel/vnd";
import { DUE_WINDOW_DAYS, type DueContractsView } from "../application/list-due-contracts";

/** "2026-10-05" → "05/10" như mockup dashboard.html. */
const formatDayMonth = (date: string) => date.slice(5).split("-").reverse().join("/");

function DueStatus({ due, today }: { due: string; today: string }) {
  const days = diffDays(today, due);
  if (days < 0) return <span className="badge badge-late">Quá {-days} ngày</span>;
  if (days === 0) return <span className="badge badge-warn">Hôm nay</span>;
  return <span className="badge badge-muted">Còn {days} ngày</span>;
}

/** Bảng "Đến hạn đóng lãi" của trang chủ: quá hạn hoặc đến hạn trong 3 ngày tới. */
export function DueContracts({ view }: { view: DueContractsView }) {
  if (view.items.length === 0) {
    return <p className="px-5 pb-5 text-sm text-slate-500">Không có hợp đồng nào quá hạn hoặc đến hạn trong {DUE_WINDOW_DAYS} ngày tới.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Mã HĐ</th>
            <th>Khách hàng</th>
            <th>Loại</th>
            <th className="text-right">Lãi kỳ này</th>
            <th>Hạn</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {view.items.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/cam-do/${c.id}`} className="text-teal-700 font-medium hover:underline">
                  {c.code}
                </Link>
              </td>
              <td>{c.customerName}</td>
              <td>{c.kind === "secured" ? "Cầm đồ" : "Tín chấp"}</td>
              <td className="text-right num">{formatVnd(c.periodInterest)}</td>
              <td className="num">{formatDayMonth(c.due)}</td>
              <td>
                <DueStatus due={c.due} today={view.today} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
