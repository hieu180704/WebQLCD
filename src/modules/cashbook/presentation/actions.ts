"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, requireSession, setOpeningBalance } from "@/composition-root";
import { parseVnd } from "@/shared/kernel/vnd";

export type OpeningBalanceState = { error: string | null; amount: string };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm được nhập quỹ đầu két.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không nhập được quỹ đầu két.",
};

const MAX_OPENING_BALANCE = 100_000_000_000n; // 100 tỷ: chặn gõ nhầm thừa chữ số.

const amountSchema = z
  .string()
  .max(30)
  .transform((text, ctx) => {
    const money = parseVnd(text);
    if (!money || !money.isPositive() || money.toBigInt() > MAX_OPENING_BALANCE) {
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
