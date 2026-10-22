import type { Metadata } from "next";
import { CustomerDetailPage } from "@/modules/reporting";

export const metadata: Metadata = { title: "Chi tiết khách hàng — TP83" };

export default async function CustomerDetailRoute({
  params,
}: PageProps<"/khach-hang/[id]">) {
  const { id } = await params;
  return <CustomerDetailPage id={id} />;
}
