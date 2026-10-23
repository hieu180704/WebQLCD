import Link from "next/link";
import type { DueInstallmentsView } from "@/modules/installment";
import { DUE_LIST_LIMIT, DUE_WINDOW_DAYS, type DueContractsView } from "@/modules/pawn";
import { diffDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { formatVnd } from "@/shared/kernel/vnd";

/** "2026-10-05" → "05/10" như mockup dashboard.html. */
const formatDayMonth = (date: string) => date.slice(5).split("-").reverse().join("/");

function DueStatus({ due, today }: { due: string; today: string }) {
  const days = diffDays(today, due);
  if (days < 0) return <span className="badge badge-late">Quá {-days} ngày</span>;
  if (days === 0) return <span className="badge badge-warn">Hôm nay</span>;
  return <span className="badge badge-muted">Còn {days} ngày</span>;
}

type DueRow = { id: string; href: string; code: string; customerName: string; kind: string; amount: Money; due: LocalDate };

/**
 * Bảng "Đến hạn" của trang chủ: hợp đồng cầm đồ/tín chấp quá hạn hoặc đến hạn đóng lãi, hợp đồng trả góp chậm góp hoặc kỳ
 * tới đến hạn, trong 3 ngày tới; hạn sớm nhất trước, tối đa 20 dòng. Mỗi nguồn đã giới hạn 20 dòng theo hạn nên gộp rồi cắt
 * vẫn đúng 20 dòng sớm nhất.
 */
export function DueTable({ contracts, installments }: { contracts: DueContractsView; installments: DueInstallmentsView }) {
  const rows: DueRow[] = [
    ...contracts.items.map((c) => ({
      id: c.id,
      href: `/cam-do/${c.id}`,
      code: c.code,
      customerName: c.customerName,
      kind: c.kind === "secured" ? "Cầm đồ" : "Tín chấp",
      amount: c.periodInterest,
      due: c.due,
    })),
    ...installments.items.map((c) => ({
      id: c.id,
      href: `/tra-gop/${c.id}`,
      code: c.code,
      customerName: c.customerName,
      kind: "Trả góp",
      amount: c.periodRemaining,
      due: c.due,
    })),
  ]
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, DUE_LIST_LIMIT);
  if (rows.length === 0) {
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
            <th className="text-right">Phải thu kỳ này</th>
            <th>Hạn</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={r.href} className="text-teal-700 font-medium hover:underline">
                  {r.code}
                </Link>
              </td>
              <td>{r.customerName}</td>
              <td>{r.kind}</td>
              <td className="text-right num">{formatVnd(r.amount)}</td>
              <td className="num">{formatDayMonth(r.due)}</td>
              <td>
                <DueStatus due={r.due} today={contracts.today} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
