"use server";

import { redirect } from "next/navigation";
import { AccessDeniedError, createContract, requireSession } from "@/composition-root";
import type { ContractRuleViolation } from "../application/create-contract";
import { CONTRACT_FORM_FIELDS, contractFormSchema } from "./schemas";

export type CreateContractState = { error: string | null; values: Record<string, string> };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Không có quyền tạo hợp đồng.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không tạo được hợp đồng mới.",
};

const RULE_MESSAGE: Record<ContractRuleViolation, string> = {
  asset_required: "Hợp đồng thế chấp phải có tên tài sản.",
  principal_not_positive: "Số tiền vay phải lớn hơn 0.",
  period_exceeds_term: "Kỳ lãi không được dài hơn số ngày vay.",
  loan_date_in_future: "Ngày vay không được sau hôm nay.",
  prepaid_not_less_than_principal: "Lãi thu trước phải nhỏ hơn số tiền vay.",
};

export async function createContractAction(_previous: CreateContractState, formData: FormData): Promise<CreateContractState> {
  const values = Object.fromEntries(CONTRACT_FORM_FIELDS.map((name) => [name, String(formData.get(name) ?? "")]));
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return { error: DENIED[error.reason], values };
    throw error;
  }

  // Checkbox không tích thì không có trong FormData.
  const parsed = contractFormSchema.safeParse({ ...values, prepaidInterest: values.prepaidInterest || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const { fullName, cccd, phone, address, note, ...terms } = parsed.data;

  const result = await createContract.execute(
    { userId: actor.userId, shopId: actor.shopId },
    { terms, customer: { fullName, cccd, phone, address }, note },
  );
  if (!result.ok) return { error: RULE_MESSAGE[result.error], values };

  const query = new URLSearchParams({ moi: result.code });
  if (result.reusedCustomerName) query.set("khach", "cu");
  redirect(`/cam-do?${query}`);
}
