"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { AccessDeniedError, createInstallment, payInstallment, requireSession } from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import type { InstallmentRuleViolation } from "../application/create-installment";
import type { PayInstallmentError } from "../application/pay-installment";
import { INSTALLMENT_FORM_FIELDS, installmentFormSchema, payInstallmentSchema } from "./schemas";

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

export type InstallmentOperationState = { error: string | null; message: string | null; done: number };

const OPERATION_DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Không có quyền thực hiện thao tác này.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không ghi được giao dịch.",
};

const STALE = "Hợp đồng vừa được cập nhật bởi thao tác khác. Số liệu đã tải lại, kiểm tra rồi thử lại.";

const PAY_MESSAGE: Record<PayInstallmentError, string> = {
  not_found: "Không tìm thấy hợp đồng.",
  closed: "Hợp đồng đã đóng.",
  stale: STALE,
  amount_not_positive: "Số tiền khách đưa phải lớn hơn 0.",
  amount_exceeds_remaining: "Số tiền khách đưa không được lớn hơn số còn phải thu.",
};

export async function payInstallmentAction(previous: InstallmentOperationState, formData: FormData): Promise<InstallmentOperationState> {
  const fail = (error: string): InstallmentOperationState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(OPERATION_DENIED[error.reason]);
    throw error;
  }

  const parsed = payInstallmentSchema.safeParse({
    contractId: formData.get("contractId"),
    expectedPaid: formData.get("expectedPaid"),
    amount: String(formData.get("amount") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await payInstallment.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (!result.ok) {
    if (result.error === "stale") refresh(); // Hộp thoại nhận số đã thu mới, bấm lại được ngay.
    return fail(PAY_MESSAGE[result.error]);
  }
  refresh(); // Số liệu, lịch góp, lịch sử cập nhật trong cùng response.
  const closed = result.closed ? ' Đã thu đủ, hợp đồng chuyển sang "Đã đóng".' : "";
  return {
    error: null,
    message: `Đã thu ${formatVnd(result.amount)} đ tiền góp, tổng đã thu ${formatVnd(result.paidAfter)} đ.${closed}`,
    done: previous.done + 1,
  };
}
