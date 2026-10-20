import { requireSession } from "@/composition-root";
import { businessDate } from "@/shared/kernel/local-date";
import { ContractForm } from "./contract-form";

/** Trang tạo hợp đồng: chủ tiệm và KTV; KTV hồ sơ là người đang đăng nhập. Quyền ghi kiểm lại ở server action. */
export async function NewContractPage() {
  await requireSession();
  return (
    <div className="max-w-3xl rounded-xl border bg-card p-6 shadow-sm">
      <ContractForm today={businessDate(new Date())} />
    </div>
  );
}
