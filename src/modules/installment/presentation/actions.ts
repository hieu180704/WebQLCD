"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  AccessDeniedError,
  closeInstallment,
  createInstallment,
  deleteInstallment,
  payInstallment,
  requireSession,
  reverseInstallmentOperation,
} from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import type { CloseInstallmentError } from "../application/close-installment";
import type { CreateInstallmentError, CreateInstallmentInput } from "../application/create-installment";
import type { DeleteInstallmentError } from "../application/delete-installment";
import type { PayInstallmentError } from "../application/pay-installment";
import type { ReverseInstallmentOperationError } from "../application/reverse-installment-operation";
import {
  INSTALLMENT_FORM_FIELDS,
  closeInstallmentSchema,
  deleteSchema,
  installmentFormSchema,
  newCustomerSchema,
  payInstallmentSchema,
  reverseSchema,
} from "./schemas";

export type CreateInstallmentState = { error: string | null; values: Record<string, string> };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Không có quyền tạo hợp đồng.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không tạo được hợp đồng mới.",
};

const RULE_MESSAGE: Record<CreateInstallmentError, string> = {
  amount_not_positive: "Tiền đưa khách phải lớn hơn 0.",
  total_less_than_given: "Tổng tiền phải thu không được nhỏ hơn tiền đưa khách.",
  period_exceeds_total: "Số ngày mỗi kỳ không được dài hơn số ngày góp.",
  start_date_in_future: "Ngày bắt đầu không được sau hôm nay.",
  customer_not_found: "Không tìm thấy khách hàng.",
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
  const { customerId, note, ...terms } = parsed.data;
  let customer: CreateInstallmentInput["customer"];
  if (customerId) {
    customer = { existingId: customerId };
  } else {
    const parsedCustomer = newCustomerSchema.safeParse(values);
    if (!parsedCustomer.success) return { error: parsedCustomer.error.issues[0].message, values };
    customer = parsedCustomer.data;
  }

  const result = await createInstallment.execute({ userId: actor.userId, shopId: actor.shopId }, { terms, customer, note });
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
  // Số liệu, lịch góp, lịch sử cập nhật trong cùng response. Thu đủ thì hợp đồng đóng, hộp thoại không còn để báo:
  // nhãn "Đã đóng" cho thấy kết quả.
  refresh();
  return {
    error: null,
    message: `Đã thu ${formatVnd(result.amount)} đ tiền góp, tổng đã thu ${formatVnd(result.paidAfter)} đ.`,
    done: previous.done + 1,
  };
}

const CLOSE_MESSAGE: Record<CloseInstallmentError, string> = {
  not_found: "Không tìm thấy hợp đồng.",
  closed: "Hợp đồng đã đóng.",
  stale: STALE,
  amount_negative: "Số tiền thu để tất toán không được âm.",
  amount_exceeds_remaining: "Số tiền thu để tất toán không được lớn hơn số còn phải thu.",
};

export async function closeInstallmentAction(previous: InstallmentOperationState, formData: FormData): Promise<InstallmentOperationState> {
  const fail = (error: string): InstallmentOperationState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(OPERATION_DENIED[error.reason]);
    throw error;
  }

  const parsed = closeInstallmentSchema.safeParse({
    contractId: formData.get("contractId"),
    expectedPaid: formData.get("expectedPaid"),
    amount: String(formData.get("amount") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await closeInstallment.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (!result.ok) {
    if (result.error === "stale") refresh();
    return fail(CLOSE_MESSAGE[result.error]);
  }
  // Hợp đồng đã đóng: trang tải lại không còn hộp thoại; nhãn trạng thái, lịch sử và dòng "Giảm khi tất toán" cho thấy kết quả.
  refresh();
  return { error: null, message: null, done: previous.done + 1 };
}

const OWNER_DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được thực hiện thao tác này.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không ghi được giao dịch.",
};

const REVERSE_MESSAGE: Record<ReverseInstallmentOperationError, string> = {
  not_found: "Không tìm thấy giao dịch để huỷ.",
  stale: "Đã có giao dịch mới hơn hoặc giao dịch vừa bị huỷ. Số liệu đã tải lại, kiểm tra rồi thử lại.",
  not_reversible: "Không huỷ riêng được giải ngân; muốn bỏ hợp đồng thì xoá hợp đồng.",
};

export async function reverseInstallmentAction(
  previous: InstallmentOperationState,
  formData: FormData,
): Promise<InstallmentOperationState> {
  const fail = (error: string): InstallmentOperationState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ role: "owner", write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(OWNER_DENIED[error.reason]);
    throw error;
  }

  const parsed = reverseSchema.safeParse({
    contractId: formData.get("contractId"),
    operationId: formData.get("operationId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await reverseInstallmentOperation.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (!result.ok) {
    if (result.error === "stale") refresh();
    return fail(REVERSE_MESSAGE[result.error]);
  }
  refresh();
  return { error: null, message: "Đã huỷ giao dịch, bút toán đảo ghi vào quỹ két hôm nay.", done: previous.done + 1 };
}

const DELETE_MESSAGE: Record<DeleteInstallmentError, string> = {
  not_found: "Không tìm thấy hợp đồng (có thể đã bị xoá).",
  code_mismatch: "Mã hợp đồng gõ lại không khớp.",
};

export async function deleteInstallmentAction(previous: InstallmentOperationState, formData: FormData): Promise<InstallmentOperationState> {
  const fail = (error: string): InstallmentOperationState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ role: "owner", write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(OWNER_DENIED[error.reason]);
    throw error;
  }

  const parsed = deleteSchema.safeParse({
    contractId: formData.get("contractId"),
    confirmCode: String(formData.get("confirmCode") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await deleteInstallment.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (!result.ok) return fail(DELETE_MESSAGE[result.error]);
  // Hợp đồng đã xoá vẫn xem được: trang tải lại hiện nhãn "Đã xoá" kèm lý do.
  refresh();
  return { error: null, message: null, done: previous.done + 1 };
}
