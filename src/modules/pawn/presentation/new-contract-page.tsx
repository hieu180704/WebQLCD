import Link from "next/link";
import { notFound } from "next/navigation";
import { getContractDefaults, prepareNewContract, requireSession } from "@/composition-root";
import { businessDate } from "@/shared/kernel/local-date";
import { ContractForm } from "./contract-form";

/**
 * Trang tạo hợp đồng: chủ tiệm và KTV; KTV hồ sơ mặc định là người đang đăng nhập, chọn được người khác.
 * `customerId` (từ nút "+ Cầm đồ" ở trang khách) điền sẵn khách có sẵn. Quyền ghi kiểm lại ở server action.
 */
export async function NewContractPage({ customerId }: { customerId: string | null }) {
  const principal = await requireSession();
  const [defaults, context] = await Promise.all([
    getContractDefaults.execute(principal.shopId),
    prepareNewContract.execute(principal.shopId, customerId),
  ]);
  if (customerId && !context.customer) notFound();
  return (
    <>
      <nav className="text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/cam-do" className="hover:underline">
          Cầm đồ & Tín chấp
        </Link>{" "}
        / Thêm hồ sơ
      </nav>
      <h1 className="mt-1 text-2xl font-bold">Thêm hồ sơ</h1>
      <ContractForm
        today={businessDate(new Date())}
        defaults={defaults}
        staff={context.staff}
        currentUserId={principal.userId}
        customer={context.customer}
      />
    </>
  );
}
