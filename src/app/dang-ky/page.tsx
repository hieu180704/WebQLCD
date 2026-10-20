import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/modules/identity";

export const metadata: Metadata = { title: "Đăng ký dùng thử — TP83" };

export default function RegisterPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-center text-xl font-semibold">TP83 — Đăng ký</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">Dùng thử miễn phí 7 ngày.</p>
        <RegisterForm />
        <p className="mt-4 text-center text-sm">
          Đã có tài khoản?{" "}
          <Link href="/dang-nhap" className="underline underline-offset-4">
            Đăng nhập
          </Link>
        </p>
      </div>
    </main>
  );
}
