import type { Metadata } from "next";
import { CustomerListPage } from "@/modules/reporting";

export const metadata: Metadata = { title: "Khách hàng — TP83" };

export default async function CustomersRoute({ searchParams }: PageProps<"/khach-hang">) {
  return <CustomerListPage query={await searchParams} />;
}
