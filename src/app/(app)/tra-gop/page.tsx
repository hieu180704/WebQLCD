import type { Metadata } from "next";
import { InstallmentListPage } from "@/modules/installment";

export const metadata: Metadata = { title: "Trả góp — TP83" };

export default async function InstallmentsRoute({ searchParams }: PageProps<"/tra-gop">) {
  return <InstallmentListPage query={await searchParams} />;
}
