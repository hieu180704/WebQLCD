"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, requireSession, updateShopInfo } from "@/composition-root";

/** `values` giữ lại giá trị đã nhập khi báo lỗi (form tự reset sau mỗi lần gửi). */
export type ShopFormState = { error: string | null; message: string | null; values: Record<string, string> | null };

const DENIED: Record<AccessDeniedError["reason"], string> = {
  inactive: "Tài khoản đã bị vô hiệu hoá.",
  role: "Chỉ chủ tiệm sửa được cài đặt cửa hàng.",
  read_only: "Cửa hàng đã hết hạn sử dụng, không sửa được cài đặt.",
};

/** Chuỗi tuỳ chọn: bỏ khoảng trắng đầu cuối, rỗng thành null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} tối đa ${max} ký tự.`)
    .transform((value) => value || null);

const shopInfoSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên cửa hàng.").max(100, "Tên cửa hàng tối đa 100 ký tự."),
  phone: optionalText(30, "Số điện thoại"),
  address: optionalText(255, "Địa chỉ"),
});

function formValues(formData: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, String(formData.get(name) ?? "")]));
}

async function ownerWriter(): Promise<{ userId: string; shopId: string } | string> {
  try {
    const { userId, shopId } = await requireSession({ role: "owner", write: true });
    return { userId, shopId };
  } catch (error) {
    if (error instanceof AccessDeniedError) return DENIED[error.reason];
    throw error;
  }
}

/** Chỉ chủ tiệm, cửa hàng còn hạn. Tên mới hiện ngay trên đầu trang (refresh). */
export async function updateShopInfoAction(_previous: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const values = formValues(formData, ["name", "phone", "address"]);
  const actor = await ownerWriter();
  if (typeof actor === "string") return { error: actor, message: null, values };
  const parsed = shopInfoSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message, message: null, values };

  const changed = await updateShopInfo.execute(actor, parsed.data);
  refresh();
  return { error: null, message: changed.length ? "Đã lưu thông tin cửa hàng." : "Không có thay đổi nào.", values: null };
}
