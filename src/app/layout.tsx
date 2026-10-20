import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// CSP nonce cần mọi trang render theo request: tắt static shell cho toàn app (Docs/Decisions/2026-10-20-csp-nonce.txt).
export const instant = false;

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam-pro",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TP83 — Quản lý cầm đồ",
  description: "Phần mềm quản lý cầm đồ, tín chấp, trả góp và quỹ két",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="vi" className={`${beVietnamPro.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
