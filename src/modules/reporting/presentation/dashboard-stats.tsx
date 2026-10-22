import Link from "next/link";
import { formatVnd } from "@/shared/kernel/vnd";
import type { DashboardStats } from "../application/get-dashboard-stats";

/** 4 ô "Thống kê hợp đồng" theo mockup dashboard.html; chưa tính trả góp. */
export function DashboardStatTiles({ stats }: { stats: DashboardStats }) {
  return (
    <section className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Thống kê hợp đồng">
      <div className="card p-5">
        <div className="text-sm text-slate-500">Đang cho vay</div>
        <div className="mt-1 text-2xl font-bold num">{formatVnd(stats.lending)}</div>
        <div className="mt-1 text-xs text-slate-500">VNĐ, gốc còn lại</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Hợp đồng đang mở</div>
        <div className="mt-1 text-2xl font-bold num">{stats.openSecured + stats.openUnsecured}</div>
        <div className="mt-1 text-xs text-slate-500">
          Cầm đồ {stats.openSecured} · Tín chấp {stats.openUnsecured}
        </div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Lãi đã thu tháng này</div>
        <div className="mt-1 text-2xl font-bold num text-emerald-700">{formatVnd(stats.interestThisMonth)}</div>
        <div className="mt-1 text-xs text-slate-500">VNĐ</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Quá hạn đóng lãi</div>
        <div className={`mt-1 text-2xl font-bold num ${stats.overdue > 0 ? "text-red-700" : ""}`}>{stats.overdue}</div>
        <Link href="/cam-do" className="mt-1 text-xs text-teal-700 hover:underline inline-block">
          Xem danh sách
        </Link>
      </div>
    </section>
  );
}
