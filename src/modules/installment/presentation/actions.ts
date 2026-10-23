"use server";

import { redirect } from "next/navigation";
import { AccessDeniedError, createInstallment, requireSession } from "@/composition-root";
import type { InstallmentRuleViolation } from "../application/create-installment";
import { INSTALLMENT_FORM_FIELDS, installmentFormSchema } from "./schemas";

export type CreateInstallmentState = { error: string | null; values: Record<string, string> };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Không có quyền tạo hợp đồng.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không tạo được hợp đồng mới.",
};

const RULE_MESSAGE: Record<InstallmentRuleViolation, string> = {
  amount_not_positive: "Tiền đưa khách phải lớn hơn 0.",
  total_less_than_given: "Tổng tiền phải thu không được nhỏ hơn tiền đưa khách.",
  period_exceeds_total: "Số ngày mỗi kỳ không được dài hơn số ngày góp.",
  start_date_in_future: "Ngày bắt đầu không được sau hôm nay.",
};

export async function createInstallmentAction(_previous: CreateInstallmentState, formData: FormData): Promise<CreateInstallmentState> {
  const values = Object.fromEntries(INSTALLMENT_FORM_FIELDS.map((name) => [name, String(formData.get(name) ?? "")]));
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return { error: DENIED[error.reason], values };
    throw error;
  }

  const parsed = installmentFormSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const { fullName, cccd, phone, address, note, ...terms } = parsed.data;

  const result = await createInstallment.execute(
    { userId: actor.userId, shopId: actor.shopId },
    { terms, customer: { fullName, cccd, phone, address }, note },
  );
  if (!result.ok) return { error: RULE_MESSAGE[result.error], values };

  const query = new URLSearchParams({ moi: result.code });
  if (result.reusedCustomerName) query.set("khach", "cu");
  redirect(`/tra-gop?${query}`);
}
