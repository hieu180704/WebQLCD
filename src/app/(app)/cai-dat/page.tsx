import type { Metadata } from "next";
import { AccountSettings } from "@/modules/identity";
import { ShopSettings } from "@/modules/shop";

export const metadata: Metadata = { title: "Cài đặt — TP83" };

// Bố cục theo mockup cai-dat.html: cột trái cài đặt cửa hàng (chỉ chủ tiệm), cột phải tài khoản của tôi.
export default function SettingsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Cài đặt cửa hàng</h1>
      <div className="mt-6 grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6 items-start">
        <div className="flex flex-col gap-6 empty:hidden">
          <ShopSettings />
        </div>
        <div className="flex flex-col gap-6 max-w-md">
          <AccountSettings />
        </div>
      </div>
    </>
  );
}
