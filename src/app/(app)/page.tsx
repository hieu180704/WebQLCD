import Link from "next/link";
import { getCashDay, requireSession } from "@/composition-root";
import { CashLineList, CashSummary } from "@/modules/cashbook";

// Trang chủ theo Design/mockup/dashboard.html, chỉ các khối đã có số liệu thật (quỹ két, giao dịch hôm nay).
const RECENT_LINES = 8;

const formatWeekday = new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", weekday: "long" }).format;

export default async function Home() {
  const principal = await requireSession();
  const day = await getCashDay.execute(principal.shopId, null, null);
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

      <section className="card mt-6 lg:max-w-xl" aria-labelledby="tx-title">
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
    </>
  );
}
