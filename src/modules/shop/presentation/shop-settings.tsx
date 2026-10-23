import { getContractDefaults, getShopProfile, requireSession } from "@/composition-root";
import { INTEREST_TYPE_OPTIONS } from "@/modules/pawn";
import { ContractDefaultsForm } from "./contract-defaults-form";
import { ShopInfoForm } from "./shop-info-form";

/** Các mục cài đặt cửa hàng ở trang Cài đặt: chỉ chủ tiệm thấy (KTV chỉ thấy "Tài khoản của tôi"). */
export async function ShopSettings() {
  const principal = await requireSession();
  if (principal.role !== "owner") return null;
  const [profile, defaults] = await Promise.all([getShopProfile.execute(principal.shopId), getContractDefaults.execute(principal.shopId)]);

  return (
    <>
      <section className="card p-5" aria-labelledby="s-shop">
        <h2 id="s-shop" className="font-semibold">
          Thông tin cửa hàng
        </h2>
        <ShopInfoForm info={profile} openedAt={profile.openedAt.split("-").reverse().join("/")} />
        <p className="mt-3 text-xs text-slate-500">Chỉ chủ tiệm sửa được. Tên cửa hàng hiện trên đầu trang.</p>
      </section>
      <section className="card p-5" aria-labelledby="s-default">
        <h2 id="s-default" className="font-semibold">
          Mặc định khi tạo hợp đồng
        </h2>
        <ContractDefaultsForm defaults={defaults} interestTypes={INTEREST_TYPE_OPTIONS} />
        <p className="mt-3 text-xs text-slate-500">
          Chỉ là giá trị điền sẵn vào form, sửa được trên từng hợp đồng. Lãi để trống thì không điền sẵn.
        </p>
      </section>
    </>
  );
}
