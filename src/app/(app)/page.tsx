import Link from "next/link";
import {
  getCashDay,
  getDashboardStats,
  getInstallmentStats,
  listDueContracts,
  listDueInstallments,
  requireSession,
} from "@/composition-root";
import { CashLineList, CashSummary } from "@/modules/cashbook";
import { DashboardStatTiles, DueTable } from "@/modules/reporting";

// Trang chủ theo Design/mockup/dashboard.html; thống kê và bảng đến hạn gồm cầm đồ, tín chấp, trả góp.
const RECENT_LINES = 8;

const formatWeekday = new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", weekday: "long" }).format;

export default async function Home() {
  const principal = await requireSession();
  const [day, stats, installmentStats, due, dueInstallments] = await Promise.all([
    getCashDay.execute(principal.shopId, null, null),
    getDashboardStats.execute(principal.shopId),
    getInstallmentStats.execute(principal.shopId),
    listDueContracts.execute(principal.shopId),
    listDueInstallments.execute(principal.shopId),
  ]);
  const today = new Date(`${day.today}T00:00:00Z`);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tổng quan</h1>
          <p className="text-sm text-slate-500">
            {formatWeekday(today)}, {day.today.split("-").reverse().join("/")}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {!day.openingBalanceSet && principal.role === "owner" && (
            <Link href="/quy-ket" className="btn btn-outline">
              Nhập quỹ đầu két
            </Link>
          )}
          <Link href="/cam-do/moi" className="btn btn-primary">
            + Thêm hồ sơ
          </Link>
        </div>
      </div>

      <section className="card mt-6 p-5" aria-labelledby="cash-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="cash-title" className="font-semibold">
            Quỹ két hôm nay
          </h2>
          <span className="text-xs text-slate-500">Quỹ đầu ngày − Tổng chi + Tổng thu = Tiền cuối ngày</span>
        </div>
        <div className="mt-4">
          <CashSummary summary={day.summary} />
        </div>
      </section>

      <DashboardStatTiles stats={stats} installments={installmentStats} />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        <section className="card" aria-labelledby="due-title">
          <div className="p-5 pb-3 flex items-center">
            <h2 id="due-title" className="font-semibold">
              Đến hạn
            </h2>
            {/* Hai danh sách riêng nên mỗi loại một link; aria-label để không trùng tên với menu "Trả góp". */}
            <span className="ml-auto text-sm text-slate-500">
              Tất cả:{" "}
              <Link href="/cam-do?tt=sap-den-han" aria-label="Tất cả cầm đồ, tín chấp đến hạn" className="text-teal-700 hover:underline">
                Cầm đồ/tín chấp
              </Link>
              {" · "}
              <Link href="/tra-gop?tt=sap-den-han" aria-label="Tất cả trả góp đến hạn" className="text-teal-700 hover:underline">
                Trả góp
              </Link>
            </span>
          </div>
          <DueTable contracts={due} installments={dueInstallments} />
        </section>

        <section className="card" aria-labelledby="tx-title">
          <div className="p-5 pb-3 flex items-center">
            <h2 id="tx-title" className="font-semibold">
              Giao dịch hôm nay
            </h2>
            <Link href="/quy-ket" className="ml-auto text-sm text-teal-700 hover:underline">
              Lịch sử
            </Link>
          </div>
          <CashLineList lines={day.lines.slice(0, RECENT_LINES)} />
        </section>
      </div>
    </>
  );
}
