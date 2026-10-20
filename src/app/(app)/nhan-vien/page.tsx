import type { Metadata } from "next";
import { StaffManagement } from "@/modules/identity";

export const metadata: Metadata = { title: "Nhân viên — TP83" };

export default function StaffPage() {
  return <StaffManagement />;
}
