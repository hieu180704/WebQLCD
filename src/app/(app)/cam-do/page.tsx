import type { Metadata } from "next";
import { getDashboardStats, requireSession } from "@/composition-root";
import { ContractListPage } from "@/modules/pawn";
import { ContractStatTiles } from "@/modules/reporting";

export const metadata: Metadata = { title: "Cầm đồ & Tín chấp — TP83" };

export default async function ContractsRoute({ searchParams }: PageProps<"/cam-do">) {
  const principal = await requireSession();
  const [query, stats] = await Promise.all([searchParams, getDashboardStats.execute(principal.shopId)]);
  return (
    <ContractListPage
      query={query}
      summary={`${stats.openSecured + stats.openUnsecured} hợp đồng đang mở`}
      stats={<ContractStatTiles stats={stats} />}
    />
  );
}
