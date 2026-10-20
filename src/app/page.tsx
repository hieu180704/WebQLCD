import Link from "next/link";
import { getSubscription } from "@/composition-root";
import { SignOutButton } from "@/modules/identity";
import { SubscriptionBanner } from "@/modules/shop";
import { requireSession } from "@/shared/infrastructure/auth/guard";

export default async function Home() {
  const principal = await requireSession();
  const subscription = await getSubscription.execute(principal.shopId);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">TP83 — Quản lý cầm đồ</h1>
      <SubscriptionBanner view={subscription} />
      {principal.role === "owner" && (
        <Link href="/nhan-vien" className="underline underline-offset-4">
          Nhân viên
        </Link>
      )}
      <SignOutButton />
    </main>
  );
}
