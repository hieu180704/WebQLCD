"use server";

import { refresh } from "next/cache";
import {
  AccessDeniedError,
  editCustomer,
  requireSession,
  revealCccd,
} from "@/composition-root";
import type { EditCustomerError } from "../application/ports";
import { editCustomerSchema, revealCccdSchema } from "./schemas";

export type EditCustomerState = {
  error: string | null;
  message: string | null;
  done: number;
};

/** `cccd` chỉ trả về đúng người vừa bấm xem, không ghi log. */
export type RevealCccdState = { error: string | null; cccd: string | null };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được xem số CCCD đầy đủ.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không sửa được thông tin.",
};

const EDIT_MESSAGE: Record<EditCustomerError, string> = {
  not_found: "Không tìm thấy khách hàng.",
  stale:
    "Thông tin khách vừa được người khác sửa. Số liệu đã tải lại, kiểm tra rồi thử lại.",
  duplicate_cccd: "Số CCCD này đã thuộc một khách hàng khác trong cửa hàng.",
};

export async function editCustomerAction(
  previous: EditCustomerState,
  formData: FormData,
): Promise<EditCustomerState> {
  const fail = (error: string): EditCustomerState => ({
    ...previous,
    error,
    message: null,
  });
  let actor;
  try {
    actor = await requireSession({ write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(DENIED[error.reason]);
    throw error;
  }

  const field = (name: string) => String(formData.get(name) ?? "");
  const parsed = editCustomerSchema.safeParse({
    customerId: formData.get("customerId"),
    fullName: field("fullName"),
    cccd: field("cccd"),
    phone: field("phone"),
    address: field("address"),
    expectedFullName: field("expectedFullName"),
    expectedPhone: field("expectedPhone"),
    expectedAddress: field("expectedAddress"),
    expectedCccdMasked: field("expectedCccdMasked"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const data = parsed.data;

  const result = await editCustomer.execute(
    { userId: actor.userId, shopId: actor.shopId },
    {
      customerId: data.customerId,
      expected: {
        fullName: data.expectedFullName,
        phone: data.expectedPhone,
        address: data.expectedAddress,
        cccdMasked: data.expectedCccdMasked,
      },
      info: {
        fullName: data.fullName,
        phone: data.phone,
        address: data.address,
      },
      cccd: data.cccd,
    },
  );
  if (!result.ok) {
    if (result.error === "stale") refresh();
    return fail(EDIT_MESSAGE[result.error]);
  }
  refresh();
  const message = result.changed.length
    ? "Đã lưu thông tin khách hàng."
    : "Không có thay đổi nào.";
  return { error: null, message, done: previous.done + 1 };
}

export async function revealCccdAction(
  _previous: RevealCccdState,
  formData: FormData,
): Promise<RevealCccdState> {
  let actor;
  try {
    actor = await requireSession({ role: "owner" });
  } catch (error) {
    if (error instanceof AccessDeniedError)
      return { error: DENIED[error.reason], cccd: null };
    throw error;
  }
  const parsed = revealCccdSchema.safeParse({
    customerId: formData.get("customerId"),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0].message, cccd: null };
  const result = await revealCccd.execute(
    { userId: actor.userId, shopId: actor.shopId },
    parsed.data.customerId,
  );
  if (!result.ok)
    return {
      error:
        result.error === "no_cccd"
          ? "Khách chưa có số CCCD."
          : "Không tìm thấy khách hàng.",
      cccd: null,
    };
  return { error: null, cccd: result.cccd };
}
