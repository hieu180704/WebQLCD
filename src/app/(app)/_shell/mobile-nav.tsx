"use client";

// Phần tương tác duy nhất của khung trang: mở/đóng sidebar trên mobile và tô mục đang xem.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, use, useState, type ReactNode } from "react";

const MenuContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MenuContext value={{ open, setOpen }}>{children}</MenuContext>;
}

export function MenuButton({ children }: { children: ReactNode }) {
  const { open, setOpen } = use(MenuContext);
  return (
    <button type="button" className="btn btn-outline lg:hidden !px-2.5" aria-label="Mở menu" aria-controls="sidebar" aria-expanded={open} onClick={() => setOpen(true)}>
      {children}
    </button>
  );
}

export function NavPanel({ children }: { children: ReactNode }) {
  const { open, setOpen } = use(MenuContext);
  return (
    <>
      <div className={`${open ? "" : "hidden"} fixed inset-0 z-30 bg-slate-900/40 lg:hidden`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside
        id="sidebar"
        className={`${open ? "flex flex-col" : "hidden"} fixed inset-y-0 left-0 z-40 w-72 shadow-xl lg:shadow-none lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-white border-r border-slate-200 overflow-y-auto`}
      >
        {children}
      </aside>
    </>
  );
}

export function MenuClose() {
  const { setOpen } = use(MenuContext);
  return (
    <button type="button" className="btn btn-outline lg:hidden !px-2.5 order-last ml-auto" aria-label="Đóng menu" onClick={() => setOpen(false)}>
      ✕
    </button>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const { setOpen } = use(MenuContext);
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
      {children}
    </Link>
  );
}
