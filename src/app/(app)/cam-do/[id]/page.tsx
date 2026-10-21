import type { Metadata } from "next";
import { ContractDetailPage } from "@/modules/pawn";

export const metadata: Metadata = { title: "Chi tiết hợp đồng — TP83" };

export default async function ContractDetailRoute({ params }: PageProps<"/cam-do/[id]">) {
  const { id } = await params;
  return <ContractDetailPage id={id} />;
}
