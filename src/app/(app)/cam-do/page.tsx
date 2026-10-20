import type { Metadata } from "next";
import { ContractListPage } from "@/modules/pawn";

export const metadata: Metadata = { title: "Cầm đồ & Tín chấp — TP83" };

export default async function ContractsRoute({ searchParams }: PageProps<"/cam-do">) {
  return <ContractListPage query={await searchParams} />;
}
