import type { Metadata } from "next";
import Link from "next/link";
import { StaffManagement } from "@/modules/identity";

export const metadata: Metadata = { title: "Nhân viên — TP83" };

export default function StaffPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nhân viên</h1>
        <Link href="/" className="text-sm underline underline-offset-4">
          Về trang chủ
        </Link>
      </div>
      <StaffManagement />
    </main>
  );
}
