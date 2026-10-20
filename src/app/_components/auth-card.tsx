import type { ReactNode } from "react";

/** Khung trang đăng nhập / đăng ký theo theme mockup (Design/mockup/index.html, khối đăng nhập). */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-gradient-to-b from-teal-50/60 to-white p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-700 text-white grid place-items-center text-xs font-bold">LOGO</div>
          <div>
            <div className="font-bold leading-tight">TP83</div>
            <div className="text-xs text-slate-500 leading-tight">Quản lý cầm đồ</div>
          </div>
        </div>
        <div className="card p-6 shadow-sm">
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
          <p className="mt-4 text-center text-sm text-slate-600">{footer}</p>
        </div>
      </div>
    </main>
  );
}
