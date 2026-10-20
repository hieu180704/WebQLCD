import type { Metadata } from "next";
import Link from "next/link";
import { NewContractPage } from "@/modules/pawn";

export const metadata: Metadata = { title: "Thêm hồ sơ cầm đồ — TP83" };

export default function NewContractRoute() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Thêm hồ sơ</h1>
        <Link href="/cam-do" className="text-sm underline underline-offset-4">
          Về danh sách
        </Link>
      </div>
      <NewContractPage />
    </main>
  );
}
