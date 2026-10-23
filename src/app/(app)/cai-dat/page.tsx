import type { Metadata } from "next";
import { AccountSettings } from "@/modules/identity";

export const metadata: Metadata = { title: "Cài đặt — TP83" };

export default function SettingsPage() {
  return <AccountSettings />;
}
