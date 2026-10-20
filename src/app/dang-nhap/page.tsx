import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "@/modules/identity";

export const metadata: Metadata = { title: "Đăng nhập — TP83" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold">TP83 — Đăng nhập</h1>
        <SignInForm />
        <p className="mt-4 text-center text-sm">
          Chưa có tài khoản?{" "}
          <Link href="/dang-ky" className="underline underline-offset-4">
            Đăng ký dùng thử 7 ngày
          </Link>
        </p>
      </div>
    </main>
  );
}
