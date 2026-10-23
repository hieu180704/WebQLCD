import type { Metadata } from "next";
import { ReportPage } from "@/modules/reporting";

export const metadata: Metadata = { title: "Báo cáo — TP83" };

export default async function ReportRoute({ searchParams }: PageProps<"/bao-cao">) {
  return <ReportPage query={await searchParams} />;
}
