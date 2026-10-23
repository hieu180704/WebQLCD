import "server-only";
import { z } from "zod";
import { normalizeCccd, normalizePhone } from "@/modules/customer";
import { isLocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import { parseVnd } from "@/shared/kernel/vnd";

const MAX_AMOUNT = 100_000_000_000n; // 100 tỷ: chặn gõ nhầm thừa chữ số.
const MAX_DAYS = 3650;

/** Chuỗi tuỳ chọn: bỏ khoảng trắng đầu cuối, rỗng thành null. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} tối đa ${max} ký tự.`)
    .transform((value) => value || null);

/** Chuỗi tuỳ chọn qua hàm chuẩn hoá; có nhập mà sai định dạng thì báo lỗi. */
const optionalNormalized = (normalize: (text: string) => string | null, message: string) =>
  z
    .string()
    .trim()
    .max(30, message)
    .transform((value, ctx) => {
      if (!value) return null;
      const normalized = normalize(value);
      if (normalized === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return normalized;
    });

const days = (label: string) =>
  z.coerce
    .number({ error: `${label}: nhập số ngày.` })
    .int(`${label}: nhập số ngày nguyên.`)
    .min(1, `${label} tối thiểu 1 ngày.`)
    .max(MAX_DAYS, `${label} tối đa ${MAX_DAYS} ngày.`);

/** Số tiền dương, tối đa 100 tỷ. */
const positiveMoney = (message: string) =>
  z
    .string()
    .max(30)
    .transform((text, ctx) => {
      const money = parseVnd(text);
      if (!money || !money.isPositive() || money.toBigInt() > MAX_AMOUNT) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return money;
    });

export const installmentFormSchema = z.object({
  fullName: z.string().trim().min(1, "Nhập tên khách hàng.").max(100, "Tên khách hàng tối đa 100 ký tự."),
  cccd: optionalNormalized(normalizeCccd, "Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số)."),
  phone: optionalNormalized(normalizePhone, "Số điện thoại gồm 8–15 chữ số."),
  address: optionalText(255, "Địa chỉ"),
  amountGiven: positiveMoney("Tiền đưa khách phải lớn hơn 0, tối đa 100 tỷ đồng."),
  totalDue: positiveMoney("Tổng tiền phải thu phải lớn hơn 0, tối đa 100 tỷ đồng."),
  totalDays: days("Số ngày góp"),
  periodDays: days("Số ngày mỗi kỳ"),
  startDate: z.string().refine((value) => isLocalDate(value) && value >= "2000-01-01", "Ngày bắt đầu không hợp lệ."),
  note: optionalText(500, "Ghi chú"),
});

export const INSTALLMENT_FORM_FIELDS = [
  "fullName",
  "cccd",
  "phone",
  "address",
  "amountGiven",
  "totalDue",
  "totalDays",
  "periodDays",
  "startDate",
  "note",
] as const;

/** Số đã thu người nhập đang thấy: chỉ dùng để so với DB (khoá lạc quan), không dùng làm số tiền. */
const lock = {
  contractId: z.uuid("Hợp đồng không hợp lệ."),
  expectedPaid: z
    .string()
    .regex(/^\d{1,15}$/, "Hợp đồng không hợp lệ.")
    .transform((text) => Money.of(BigInt(text))),
};

export const payInstallmentSchema = z.object({
  ...lock,
  amount: positiveMoney("Số tiền khách đưa phải lớn hơn 0."),
});

export const closeInstallmentSchema = z.object({
  ...lock,
  amount: z
    .string()
    .max(30)
    .transform((text, ctx) => {
      const money = parseVnd(text);
      if (!money || money.toBigInt() > MAX_AMOUNT) {
        ctx.addIssue({ code: "custom", message: "Số tiền thu để tất toán là số không âm (nhập 0 nếu miễn hết)." });
        return z.NEVER;
      }
      return money;
    }),
});

const reason = (label: string) => z.string().trim().min(1, `Nhập ${label.toLowerCase()}.`).max(200, `${label} tối đa 200 ký tự.`);

export const reverseSchema = z.object({
  contractId: z.uuid("Hợp đồng không hợp lệ."),
  operationId: z.uuid("Giao dịch không hợp lệ."),
  reason: reason("Lý do huỷ"),
});

export const deleteSchema = z.object({
  contractId: z.uuid("Hợp đồng không hợp lệ."),
  confirmCode: z.string().max(30),
  reason: reason("Lý do xoá"),
});
