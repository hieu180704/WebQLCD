import { SignOutButton } from "@/modules/identity";
import { requireSession } from "@/shared/infrastructure/auth/guard";

export default async function Home() {
  await requireSession();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">TP83 — Quản lý cầm đồ</h1>
      <SignOutButton />
    </main>
  );
}
