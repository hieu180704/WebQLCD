import "server-only";
import { z } from "zod";
import { normalizeCccd, normalizePhone } from "@/shared/kernel/personal-data";

/** Chuỗi tuỳ chọn: bỏ khoảng trắng đầu cuối, rỗng thành null. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || null);

/** Chuỗi tuỳ chọn qua hàm chuẩn hoá; có nhập mà sai định dạng thì báo lỗi. */
const optionalNormalized = (
  normalize: (text: string) => string | null,
  message: string,
) =>
  optionalText(30, message).transform((value, ctx) => {
    if (value === null) return null;
    const normalized = normalize(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return normalized;
  });

// Cùng giới hạn với form tạo hợp đồng (pawn/presentation/schemas.ts).
const fullName = z
  .string()
  .trim()
  .min(1, "Nhập tên khách hàng.")
  .max(100, "Tên khách hàng tối đa 100 ký tự.");
const phone = optionalNormalized(
  normalizePhone,
  "Số điện thoại gồm 8–15 chữ số.",
);
const address = optionalText(255, "Địa chỉ tối đa 255 ký tự.");

export const editCustomerSchema = z.object({
  customerId: z.uuid("Khách hàng không hợp lệ."),
  fullName,
  // Để trống = giữ nguyên CCCD.
  cccd: optionalNormalized(
    normalizeCccd,
    "Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số).",
  ),
  phone,
  address,
  // Giá trị lúc mở hộp thoại (khoá lạc quan), cùng cách chuẩn hoá với giá trị mới.
  expectedFullName: z.string().trim().max(100),
  expectedPhone: optionalText(30, "Số điện thoại không hợp lệ."),
  expectedAddress: optionalText(255, "Địa chỉ không hợp lệ."),
  expectedCccdMasked: optionalText(20, "CCCD không hợp lệ."),
});

export const revealCccdSchema = z.object({
  customerId: z.uuid("Khách hàng không hợp lệ."),
});
