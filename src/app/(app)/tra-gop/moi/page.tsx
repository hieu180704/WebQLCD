import type { Metadata } from "next";
import { z } from "zod";
import { NewInstallmentPage } from "@/modules/installment";

export const metadata: Metadata = { title: "Thêm hợp đồng trả góp — TP83" };

export default async function NewInstallmentRoute({ searchParams }: PageProps<"/tra-gop/moi">) {
  const { khach } = await searchParams;
  // ?khach=<id>: mở từ trang khách; id sai định dạng thì như không có (form khách mới).
  const customerId = z.uuid().safeParse(khach);
  return <NewInstallmentPage customerId={customerId.success ? customerId.data : null} />;
}
