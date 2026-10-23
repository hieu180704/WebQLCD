"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AccessDeniedError, requireSession, updateContractDefaults, updateShopInfo } from "@/composition-root";
import { INTEREST_TYPE_OPTIONS, formatRate, parseRate } from "@/modules/pawn";

/**
 * `values` giữ lại giá trị đã nhập khi báo lỗi. React tự reset form sau mỗi lần gửi và đưa `<select>` về option SSR,
 * nên form dùng `version` làm `key` để dựng lại với `defaultValue` mới.
 */
export type ShopFormState = { error: string | null; message: string | null; values: Record<string, string> | null; version: number };

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

const MAX_DAYS = 3650;

const days = (label: string) =>
  z.coerce
    .number({ error: `${label}: nhập số ngày.` })
    .int(`${label}: nhập số ngày nguyên.`)
    .min(1, `${label} tối thiểu 1 ngày.`)
    .max(MAX_DAYS, `${label} tối đa ${MAX_DAYS} ngày.`);

// Cùng luật với form tạo hợp đồng (pawn/presentation/schemas.ts); lãi để trống = không điền sẵn.
const contractDefaultsSchema = z.object({
  interestType: z.string().transform((text, ctx) => {
    const option = INTEREST_TYPE_OPTIONS.find((o) => o.value === text);
    if (!option) {
      ctx.addIssue({ code: "custom", message: "Chọn hình thức lãi." });
      return z.NEVER;
    }
    return option.value;
  }),
  interestRate: z
    .string()
    .trim()
    .max(20)
    .transform((text, ctx) => {
      if (!text) return null;
      const rate = parseRate(text);
      if (rate === null) {
        ctx.addIssue({ code: "custom", message: "Lãi là số không âm, tối đa 4 chữ số thập phân." });
        return z.NEVER;
      }
      return formatRate(rate);
    }),
  termDays: days("Số ngày vay"),
  interestPeriodDays: days("Kỳ lãi"),
  prepaidInterest: z
    .literal("on")
    .optional()
    .transform((value) => value === "on"),
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
export async function updateShopInfoAction(previous: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const values = formValues(formData, ["name", "phone", "address"]);
  const actor = await ownerWriter();
  if (typeof actor === "string") return { error: actor, message: null, values, version: previous.version + 1 };
  const parsed = shopInfoSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message, message: null, values, version: previous.version + 1 };

  const changed = await updateShopInfo.execute(actor, parsed.data);
  refresh();
  return {
    error: null,
    message: changed.length ? "Đã lưu thông tin cửa hàng." : "Không có thay đổi nào.",
    values: null,
    version: previous.version + 1,
  };
}

/** Chỉ chủ tiệm, cửa hàng còn hạn. Chỉ là giá trị điền sẵn vào form tạo hợp đồng. */
export async function updateContractDefaultsAction(previous: ShopFormState, formData: FormData): Promise<ShopFormState> {
  const values = formValues(formData, ["interestType", "interestRate", "termDays", "interestPeriodDays", "prepaidInterest"]);
  const actor = await ownerWriter();
  if (typeof actor === "string") return { error: actor, message: null, values, version: previous.version + 1 };
  const parsed = contractDefaultsSchema.safeParse({ ...values, prepaidInterest: formData.get("prepaidInterest") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message, message: null, values, version: previous.version + 1 };

  const result = await updateContractDefaults.execute(actor, parsed.data);
  if (!result.ok) return { error: "Kỳ lãi không được dài hơn số ngày vay.", message: null, values, version: previous.version + 1 };
  refresh();
  return {
    error: null,
    message: result.changed.length ? "Đã lưu mặc định." : "Không có thay đổi nào.",
    values: null,
    version: previous.version + 1,
  };
}
