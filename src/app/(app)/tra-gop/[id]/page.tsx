import type { Metadata } from "next";
import { InstallmentDetailPage } from "@/modules/installment";

export const metadata: Metadata = { title: "Chi tiết hợp đồng trả góp — TP83" };

export default async function InstallmentDetailRoute({ params, searchParams }: PageProps<"/tra-gop/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <InstallmentDetailPage id={id} fullSchedule={query.lich === "du"} />;
}
