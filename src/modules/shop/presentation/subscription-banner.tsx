import type { SubscriptionView } from "../application/get-subscription";

const formatDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format;

export function SubscriptionBanner({ view }: { view: SubscriptionView }) {
  if (view.kind === "trial") {
    return (
      <p role="status" className="rounded-lg border bg-muted px-4 py-2 text-sm">
        Dùng thử: còn {view.daysLeft} ngày (đến {formatDate(view.endsAt)}).
      </p>
    );
  }
  if (view.kind === "paid") {
    return (
      <p role="status" className="rounded-lg border bg-muted px-4 py-2 text-sm">
        Thuê bao đến {formatDate(view.until)}.
      </p>
    );
  }
  return (
    <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      Cửa hàng đã hết hạn sử dụng: chỉ xem được dữ liệu, không thêm hoặc sửa được.
    </p>
  );
}
