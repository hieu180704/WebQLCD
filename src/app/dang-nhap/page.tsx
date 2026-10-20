import type { Metadata } from "next";
import { SignInForm } from "@/modules/identity";

export const metadata: Metadata = { title: "Đăng nhập — TP83" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold">TP83 — Đăng nhập</h1>
        <SignInForm />
      </div>
    </main>
  );
}
