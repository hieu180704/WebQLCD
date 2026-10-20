import type { Metadata } from "next";
import Link from "next/link";
import { ContractListPage } from "@/modules/pawn";

export const metadata: Metadata = { title: "Cầm đồ — TP83" };

export default async function ContractsRoute({ searchParams }: PageProps<"/cam-do">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Cầm đồ / Tín chấp</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/cam-do/moi" className="rounded-md bg-primary px-3 py-2 text-primary-foreground">
            Thêm hồ sơ
          </Link>
          <Link href="/" className="underline underline-offset-4">
            Về trang chủ
          </Link>
        </div>
      </div>
      <ContractListPage query={await searchParams} />
    </main>
  );
}
