import type { Metadata } from "next";
import { NewContractPage } from "@/modules/pawn";

export const metadata: Metadata = { title: "Thêm hồ sơ cầm đồ — TP83" };

export default function NewContractRoute() {
  return <NewContractPage />;
}
