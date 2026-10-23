import Link from "next/link";
import { requireSession } from "@/composition-root";
import { businessDate } from "@/shared/kernel/local-date";
import { InstallmentForm } from "./installment-form";

/** Trang tạo hợp đồng trả góp: chủ tiệm và KTV; KTV hồ sơ là người đang đăng nhập. Quyền ghi kiểm lại ở server action. */
export async function NewInstallmentPage() {
  await requireSession();
  return (
    <>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/tra-gop" className="hover:underline">
          Trả góp
        </Link>{" "}
        / Thêm hợp đồng
      </nav>
      <h1 className="mt-1 text-2xl font-bold">Thêm hợp đồng trả góp</h1>
      <InstallmentForm today={businessDate(new Date())} />
    </>
  );
}
