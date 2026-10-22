"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, recordManualEntry, requireSession, reverseManualEntry, setOpeningBalance } from "@/composition-root";
import type { ReverseManualEntryResult } from "../application/reverse-manual-entry";
import { parseVnd } from "@/shared/kernel/vnd";

export type OpeningBalanceState = { error: string | null; amount: string };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được nhập quỹ đầu két.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không nhập được quỹ đầu két.",
};

const MAX_AMOUNT = 100_000_000_000n; // 100 tỷ: chặn gõ nhầm thừa chữ số.

const amountSchema = z
  .string()
  .max(30)
  .transform((text, ctx) => {
    const money = parseVnd(text);
    if (!money || !money.isPositive() || money.toBigInt() > MAX_AMOUNT) {
      ctx.addIssue({ code: "custom", message: "Nhập số tiền lớn hơn 0, tối đa 100 tỷ đồng." });
      return z.NEVER;
    }
    return money;
  });

export async function setOpeningBalanceAction(_previous: OpeningBalanceState, formData: FormData): Promise<OpeningBalanceState> {
  const amount = String(formData.get("amount") ?? "");
  let actor;
  try {
    actor = await requireSession({ role: "owner", write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return { error: DENIED[error.reason], amount };
    throw error;
  }

  const parsed = amountSchema.safeParse(amount);
  if (!parsed.success) return { error: parsed.error.issues[0].message, amount };

  const result = await setOpeningBalance.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (result === "already_set") return { error: "Cửa hàng đã nhập quỹ đầu két rồi.", amount };
  if (result === "not_positive") return { error: "Nhập số tiền lớn hơn 0.", amount };
  refresh(); // Tổng két và danh sách giao dịch cập nhật ngay trong cùng response.
  return { error: null, amount: "" };
}

/** `amount`, `note` là giá trị đã nhập, trả lại khi lỗi để form không bị xoá trắng. */
export type ManualEntryState = { error: string | null; message: string | null; done: number; amount: string; note: string };

const MANUAL_DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được nạp vốn.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không ghi được phiếu.",
};

const MANUAL_DONE = { manual_income: "Đã lưu phiếu thu.", manual_expense: "Đã lưu phiếu chi.", capital_in: "Đã nạp vốn vào két." } as const;

const manualTypeSchema = z.enum(["manual_income", "manual_expense", "capital_in"]);

const manualSchema = z.object({
  type: manualTypeSchema,
  amount: amountSchema,
  note: z
    .string()
    .trim()
    .max(200, "Nội dung tối đa 200 ký tự.")
    .transform((text) => text || null),
});

/** Phiếu thu khác / chi khác (mọi vai trò) và nạp vốn (chỉ chủ tiệm), ghi vào sổ két hôm nay. */
export async function recordManualEntryAction(previous: ManualEntryState, formData: FormData): Promise<ManualEntryState> {
  const amount = String(formData.get("amount") ?? "");
  const note = String(formData.get("note") ?? "");
  const fail = (error: string): ManualEntryState => ({ ...previous, error, message: null, amount, note });
  const type = manualTypeSchema.safeParse(formData.get("type"));
  let actor;
  try {
    actor = await requireSession({ role: type.data === "capital_in" ? "owner" : undefined, write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(MANUAL_DENIED[error.reason]);
    throw error;
  }

  const parsed = manualSchema.safeParse({ type: formData.get("type"), amount, note });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await recordManualEntry.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data);
  if (result === "not_positive") return fail("Nhập số tiền lớn hơn 0.");
  if (result === "note_required") return fail("Nhập nội dung phiếu.");
  refresh();
  return { error: null, message: MANUAL_DONE[parsed.data.type], done: previous.done + 1, amount: "", note: "" };
}

export type ReverseEntryState = { error: string | null; message: string | null; done: number };

const REVERSE_DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được huỷ phiếu.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không huỷ được phiếu.",
};

const REVERSE_MESSAGE: Record<Exclude<ReverseManualEntryResult, "ok">, string> = {
  reason_required: "Nhập lý do huỷ.",
  not_found: "Không tìm thấy phiếu.",
  not_manual: "Chỉ huỷ được phiếu thu khác, chi khác, nạp vốn. Giao dịch hợp đồng huỷ ở trang chi tiết hợp đồng.",
  already_reversed: "Phiếu này đã được huỷ.",
};

const reverseSchema = z.object({
  transactionId: z.uuid("Không tìm thấy phiếu."),
  reason: z.string().trim().max(200, "Lý do tối đa 200 ký tự."),
});

/** Huỷ phiếu thu khác / chi khác / nạp vốn bằng bút toán đảo (chỉ chủ tiệm). */
export async function reverseManualEntryAction(previous: ReverseEntryState, formData: FormData): Promise<ReverseEntryState> {
  const reason = String(formData.get("reason") ?? "");
  const fail = (error: string): ReverseEntryState => ({ ...previous, error, message: null });
  let actor;
  try {
    actor = await requireSession({ role: "owner", write: true });
  } catch (error) {
    if (error instanceof AccessDeniedError) return fail(REVERSE_DENIED[error.reason]);
    throw error;
  }

  const parsed = reverseSchema.safeParse({ transactionId: formData.get("transactionId"), reason });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const result = await reverseManualEntry.execute({ userId: actor.userId, shopId: actor.shopId }, parsed.data.transactionId, parsed.data.reason);
  if (result !== "ok") {
    if (result === "already_reversed") refresh();
    return fail(REVERSE_MESSAGE[result]);
  }
  refresh();
  return { error: null, message: "Đã huỷ phiếu.", done: previous.done + 1 };
}
