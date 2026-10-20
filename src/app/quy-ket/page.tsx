import type { Metadata } from "next";
import Link from "next/link";
import { CashbookPage } from "@/modules/cashbook";

export const metadata: Metadata = { title: "Quỹ két — TP83" };

export default async function CashbookRoute({ searchParams }: PageProps<"/quy-ket">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Quỹ két</h1>
        <Link href="/" className="text-sm underline underline-offset-4">
          Về trang chủ
        </Link>
      </div>
      <CashbookPage query={await searchParams} />
    </main>
  );
}
