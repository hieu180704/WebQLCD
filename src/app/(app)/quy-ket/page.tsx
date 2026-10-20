import type { Metadata } from "next";
import { CashbookPage } from "@/modules/cashbook";

export const metadata: Metadata = { title: "Quỹ két — TP83" };

export default async function CashbookRoute({ searchParams }: PageProps<"/quy-ket">) {
  return <CashbookPage query={await searchParams} />;
}
