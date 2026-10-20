import Link from "next/link";
import { requireSession } from "@/composition-root";
import { businessDate } from "@/shared/kernel/local-date";
import { ContractForm } from "./contract-form";

/** Trang tạo hợp đồng: chủ tiệm và KTV; KTV hồ sơ là người đang đăng nhập. Quyền ghi kiểm lại ở server action. */
export async function NewContractPage() {
  await requireSession();
  return (
    <>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/cam-do" className="hover:underline">
          Cầm đồ & Tín chấp
        </Link>{" "}
        / Thêm hồ sơ
      </nav>
      <h1 className="mt-1 text-2xl font-bold">Thêm hồ sơ</h1>
      <ContractForm today={businessDate(new Date())} />
    </>
  );
}
