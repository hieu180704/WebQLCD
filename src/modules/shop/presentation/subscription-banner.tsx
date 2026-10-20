import type { SubscriptionView } from "../application/get-subscription";

const formatDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format;

/** Ô thuê bao ở chân sidebar. Không dùng role="status" để không trùng thông báo của từng trang. */
export function SubscriptionBanner({ view }: { view: SubscriptionView }) {
  if (view.kind === "trial") {
    return (
      <section aria-label="Thuê bao" className="rounded-lg bg-amber-50 text-amber-800 p-3">
        <div className="font-semibold">Dùng thử: còn {view.daysLeft} ngày</div>
        <div className="text-xs mt-1">Hết hạn {formatDate(view.endsAt)}. Sau đó tài khoản chỉ xem được dữ liệu.</div>
      </section>
    );
  }
  if (view.kind === "paid") {
    return (
      <section aria-label="Thuê bao" className="rounded-lg bg-slate-50 text-slate-700 p-3">
        <div className="font-semibold">Thuê bao đến {formatDate(view.until)}</div>
      </section>
    );
  }
  return (
    <section aria-label="Thuê bao" className="rounded-lg bg-red-50 text-red-800 p-3">
      <div className="font-semibold">Cửa hàng đã hết hạn sử dụng</div>
      <div className="text-xs mt-1">Chỉ xem được dữ liệu, không thêm hoặc sửa được.</div>
    </section>
  );
}
