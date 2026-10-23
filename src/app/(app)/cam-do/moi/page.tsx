import type { Metadata } from "next";
import { z } from "zod";
import { NewContractPage } from "@/modules/pawn";

export const metadata: Metadata = { title: "Thêm hồ sơ cầm đồ — TP83" };

export default async function NewContractRoute({ searchParams }: PageProps<"/cam-do/moi">) {
  const { khach } = await searchParams;
  // ?khach=<id>: mở từ trang khách; id sai định dạng thì như không có (form khách mới).
  const customerId = z.uuid().safeParse(khach);
  return <NewContractPage customerId={customerId.success ? customerId.data : null} />;
}
