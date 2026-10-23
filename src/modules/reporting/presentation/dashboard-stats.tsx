import Link from "next/link";
import type { InstallmentStats } from "@/modules/installment";
import { formatVnd } from "@/shared/kernel/vnd";
import type { DashboardStats } from "../application/get-dashboard-stats";

/**
 * 4 ô "Thống kê hợp đồng" theo mockup dashboard.html, gồm cả trả góp (`installments` là ô thống kê của `/tra-gop`).
 * Lãi chỉ của cầm đồ/tín chấp: tiền góp không tách gốc và lãi nên hiện riêng.
 */
export function DashboardStatTiles({ stats, installments }: { stats: DashboardStats; installments: InstallmentStats }) {
  const overdue = stats.overdue + installments.lateCount;
  return (
    <section className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Thống kê hợp đồng">
      <div className="card p-5">
        <div className="text-sm text-slate-500">Đang cho vay</div>
        <div className="mt-1 text-2xl font-bold num">{formatVnd(stats.lending.add(installments.remainingOpen))}</div>
        <div className="mt-1 text-xs text-slate-500">VNĐ, gốc còn lại + trả góp còn phải thu</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Hợp đồng đang mở</div>
        <div className="mt-1 text-2xl font-bold num">{stats.openSecured + stats.openUnsecured + installments.openCount}</div>
        <div className="mt-1 text-xs text-slate-500">
          Cầm đồ {stats.openSecured} · Tín chấp {stats.openUnsecured} · Trả góp {installments.openCount}
        </div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Lãi đã thu tháng này</div>
        <div className="mt-1 text-2xl font-bold num text-emerald-700">{formatVnd(stats.interestThisMonth)}</div>
        <div className="mt-1 text-xs text-slate-500">VNĐ · Thu góp tháng này {formatVnd(installments.collectedThisMonth)}</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Quá hạn / chậm góp</div>
        <div className={`mt-1 text-2xl font-bold num ${overdue > 0 ? "text-red-700" : ""}`}>{overdue}</div>
        <div className="mt-1 text-xs">
          <Link href="/cam-do?tt=qua-han" className="text-teal-700 hover:underline">
            Cầm đồ/tín chấp {stats.overdue}
          </Link>
          {" · "}
          <Link href="/tra-gop?tt=cham-gop" className="text-teal-700 hover:underline">
            Trả góp {installments.lateCount}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** 4 ô thống kê ở `/cam-do` theo mockup cam-do.html; cả cửa hàng, không theo bộ lọc; chỉ cầm đồ/tín chấp. */
export function ContractStatTiles({ stats }: { stats: DashboardStats }) {
  return (
    <section className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Thống kê hợp đồng">
      <div className="card p-5">
        <div className="text-sm text-slate-500">Tiền đang cho vay</div>
        <div className="mt-1 text-2xl font-bold num">{formatVnd(stats.lending)}</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Lãi đến hôm nay</div>
        <div className="mt-1 text-2xl font-bold num">{formatVnd(stats.accruedInterest)}</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Lãi đã thu tháng này</div>
        <div className="mt-1 text-2xl font-bold num text-emerald-700">{formatVnd(stats.interestThisMonth)}</div>
      </div>
      <div className="card p-5">
        <div className="text-sm text-slate-500">Quá hạn</div>
        <div className={`mt-1 text-2xl font-bold num ${stats.overdue > 0 ? "text-red-700" : ""}`}>{stats.overdue}</div>
      </div>
    </section>
  );
}
