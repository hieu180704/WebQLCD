import type { Metadata } from "next";
import { NewInstallmentPage } from "@/modules/installment";

export const metadata: Metadata = { title: "Thêm hợp đồng trả góp — TP83" };

export default function NewInstallmentRoute() {
  return <NewInstallmentPage />;
}
