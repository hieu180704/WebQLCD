import { getShopProfile, requireSession } from "@/composition-root";
import { ShopInfoForm } from "./shop-info-form";

/** Các mục cài đặt cửa hàng ở trang Cài đặt: chỉ chủ tiệm thấy (KTV chỉ thấy "Tài khoản của tôi"). */
export async function ShopSettings() {
  const principal = await requireSession();
  if (principal.role !== "owner") return null;
  const profile = await getShopProfile.execute(principal.shopId);

  return (
    <section className="card p-5" aria-labelledby="s-shop">
      <h2 id="s-shop" className="font-semibold">
        Thông tin cửa hàng
      </h2>
      <ShopInfoForm info={profile} openedAt={profile.openedAt.split("-").reverse().join("/")} />
      <p className="mt-3 text-xs text-slate-500">Chỉ chủ tiệm sửa được. Tên cửa hàng hiện trên đầu trang.</p>
    </section>
  );
}
