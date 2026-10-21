"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { AccessDeniedError, createContract, payInterest, redeemContract, requireSession } from "@/composition-root";
import { formatVnd } from "@/shared/kernel/vnd";
import type { ContractRuleViolation } from "../application/create-contract";
import type { PayInterestError } from "../application/pay-interest";
import type { RedeemContractError } from "../application/redeem-contract";
import { formatDay } from "./format";
import { CONTRACT_FORM_FIELDS, contractFormSchema, payInterestSchema, redeemSchema } from "./schemas";

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

export type ContractOperationState = { error: string | null; message: string | null; done: number };

const OPERATION_DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Không có quyền thực hiện thao tác này.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không ghi được giao dịch.",
};

const PAY_INTEREST_MESSAGE: Record<PayInterestError, string> = {
  not_found: "Không tìm thấy hợp đồng.",
  closed: "Hợp đồng đã đóng.",
  stale: "Hợp đồng vừa được cập nhật bởi thao tác khác. Số liệu đã tải lại, kiểm tra rồi thử lại.",
  no_interest_due: "Hợp đồng không có lãi phải đóng.",
  invalid_periods: "Kỳ đóng lãi không hợp lệ.",
  amount_not_positive: "Số tiền khách đưa phải lớn hơn 0.",
  amount_exceeds_due: "Số tiền khách đưa không được lớn hơn tiền lãi của các kỳ đã chọn.",
};

export async function payInterestAction(previous: ContractOperationState, formData: FormData): Promise<ContractOperationState> {
  const fail = (error: string): ContractOperationState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(OPERATION_DENIED[error.reason]);
    throw error;
  }

  const parsed = payInterestSchema.safeParse({
    contractId: formData.get("contractId"),
    periods: formData.get("periods"),
    expectedPaidUntil: formData.get("expectedPaidUntil"),
    amount: String(formData.get("amount") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await payInterest.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (!result.ok) {
    if (result.error === "stale") refresh(); // Hộp thoại nhận ngày trả đến mới, bấm lại được ngay.
    return fail(PAY_INTEREST_MESSAGE[result.error]);
  }
  refresh(); // Số liệu, lịch đóng lãi, lịch sử cập nhật trong cùng response.
  return {
    error: null,
    message: `Đã thu ${formatVnd(result.amount)} đ tiền lãi, lãi đã trả đến ${formatDay(result.paidUntil)}.`,
    done: previous.done + 1,
  };
}

const REDEEM_MESSAGE: Record<RedeemContractError, string> = {
  not_found: "Không tìm thấy hợp đồng.",
  closed: "Hợp đồng đã đóng.",
  stale: "Số tiền phải thu đã thay đổi (có thao tác khác hoặc đã sang ngày mới). Số liệu đã tải lại, kiểm tra rồi thử lại.",
  interest_negative: "Tiền lãi thu không được âm.",
  interest_exceeds_due: "Tiền lãi thu không được lớn hơn lãi đến hôm nay.",
};

export async function redeemContractAction(previous: ContractOperationState, formData: FormData): Promise<ContractOperationState> {
  const fail = (error: string): ContractOperationState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(OPERATION_DENIED[error.reason]);
    throw error;
  }

  const parsed = redeemSchema.safeParse({
    contractId: formData.get("contractId"),
    expectedPaidUntil: formData.get("expectedPaidUntil"),
    expectedOutstanding: formData.get("expectedOutstanding"),
    asOf: formData.get("asOf"),
    interest: String(formData.get("interest") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await redeemContract.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (!result.ok) {
    if (result.error === "stale") refresh();
    return fail(REDEEM_MESSAGE[result.error]);
  }
  // Hợp đồng đã đóng: trang tải lại không còn hộp thoại; nhãn trạng thái và lịch sử giao dịch cho thấy kết quả.
  refresh();
  return { error: null, message: null, done: previous.done + 1 };
}
