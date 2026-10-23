import type { ReactNode } from "react";
import { getSubscription, requireProfile } from "@/composition-root";
import { SignOutButton } from "@/modules/identity";
import { SubscriptionBanner } from "@/modules/shop";
import { Icon, type IconName } from "./_shell/icons";
import { MenuButton, MenuClose, MobileNavProvider, NavLink, NavPanel } from "./_shell/mobile-nav";

// Khung trang quản lý theo Design/mockup/assets/layout.js. Layout không render lại khi điều hướng,
// nên mỗi page vẫn tự gọi guard; ở đây guard chỉ để lấy tên hiển thị (React.cache, không tra thêm DB).
type NavItem = { label: string; icon: IconName; href?: string; ownerOnly?: boolean };

const NAV: NavItem[] = [
  { label: "Tổng quan", icon: "home", href: "/" },
  { label: "Cầm đồ & Tín chấp", icon: "pawn", href: "/cam-do" },
  { label: "Trả góp", icon: "installment", href: "/tra-gop" },
  { label: "Quỹ két & Thu chi", icon: "cash", href: "/quy-ket" },
  { label: "Khách hàng", icon: "customer", href: "/khach-hang" },
  { label: "Báo cáo", icon: "report", href: "/bao-cao", ownerOnly: true },
  { label: "Sao lưu & Xuất Excel", icon: "backup" },
  { label: "Nhân viên", icon: "staff", href: "/nhan-vien", ownerOnly: true },
  { label: "Cài đặt cửa hàng", icon: "settings", href: "/cai-dat" },
];

const ROLE_LABEL = { owner: "Chủ tiệm", staff: "KTV" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile();
  const subscription = await getSubscription.execute(profile.shopId);

  return (
    <MobileNavProvider>
      <div className="flex-1 min-h-screen flex flex-col lg:flex-row">
        <NavPanel>
          <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200">
            <MenuClose />
            <div className="w-9 h-9 rounded-lg bg-teal-700 text-white grid place-items-center text-xs font-bold">LOGO</div>
            <div>
              <div className="font-bold leading-tight">TP83</div>
              <div className="text-xs text-slate-500 leading-tight">Quản lý cầm đồ</div>
            </div>
          </div>
          <nav className="flex-1 p-3 flex flex-col gap-1" aria-label="Menu chính">
            {NAV.filter((n) => !n.ownerOnly || profile.role === "owner").map((n) =>
              n.href ? (
                <NavLink key={n.label} href={n.href}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </NavLink>
              ) : (
                <span key={n.label} className="nav-link" aria-disabled="true" title="Sắp có">
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </span>
              ),
            )}
          </nav>
          <div className="p-4 border-t border-slate-200 text-sm">
            <SubscriptionBanner view={subscription} />
          </div>
        </NavPanel>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center gap-3">
            <MenuButton>
              <Icon name="menu" />
            </MenuButton>
            <div className="min-w-0">
              <div className="text-xs text-slate-500">Cửa hàng</div>
              <div className="font-semibold truncate">{profile.shopName}</div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden sm:block text-right">
                <div className="text-sm font-medium">{profile.userName}</div>
                <div className="text-xs text-slate-500">{ROLE_LABEL[profile.role]}</div>
              </div>
              <SignOutButton />
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </MobileNavProvider>
  );
}
