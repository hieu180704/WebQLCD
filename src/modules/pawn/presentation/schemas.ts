import "server-only";
import { z } from "zod";
import { normalizeCccd, normalizePhone } from "@/modules/customer";
import { isLocalDate } from "@/shared/kernel/local-date";
import { parseVnd } from "@/shared/kernel/vnd";
import { parseRate } from "../application/preview";

const MAX_PRINCIPAL = 100_000_000_000n; // 100 tỷ: chặn gõ nhầm thừa chữ số.
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

export const contractFormSchema = z.object({
  fullName: z.string().trim().min(1, "Nhập tên khách hàng.").max(100, "Tên khách hàng tối đa 100 ký tự."),
  cccd: optionalNormalized(normalizeCccd, "Số CCCD gồm 12 chữ số (hoặc CMND 9 chữ số)."),
  phone: optionalNormalized(normalizePhone, "Số điện thoại gồm 8–15 chữ số."),
  address: optionalText(255, "Địa chỉ"),
  kind: z.enum(["secured", "unsecured"], { error: "Chọn loại tài sản." }),
  assetName: optionalText(200, "Tên tài sản"),
  principal: z
    .string()
    .max(30)
    .transform((text, ctx) => {
      const money = parseVnd(text);
      if (!money || !money.isPositive() || money.toBigInt() > MAX_PRINCIPAL) {
        ctx.addIssue({ code: "custom", message: "Số tiền vay phải lớn hơn 0, tối đa 100 tỷ đồng." });
        return z.NEVER;
      }
      return money;
    }),
  loanDate: z
    .string()
    .refine((value) => isLocalDate(value) && value >= "2000-01-01", "Ngày vay không hợp lệ."),
  interestType: z.enum(["per_million_per_day", "percent_per_month", "percent_per_week"], { error: "Chọn hình thức lãi." }),
  interestRate: z
    .string()
    .max(20)
    .transform((text, ctx) => {
      const rate = parseRate(text);
      if (rate === null) {
        ctx.addIssue({ code: "custom", message: "Lãi là số không âm, tối đa 4 chữ số thập phân." });
        return z.NEVER;
      }
      return rate;
    }),
  termDays: days("Số ngày vay"),
  interestPeriodDays: days("Kỳ lãi"),
  prepaidInterest: z.literal("on").optional().transform((value) => value === "on"),
  note: optionalText(500, "Ghi chú"),
});

export const CONTRACT_FORM_FIELDS = [
  "fullName",
  "cccd",
  "phone",
  "address",
  "kind",
  "assetName",
  "principal",
  "loanDate",
  "interestType",
  "interestRate",
  "termDays",
  "interestPeriodDays",
  "prepaidInterest",
  "note",
] as const;

export const payInterestSchema = z.object({
  contractId: z.uuid("Hợp đồng không hợp lệ."),
  periods: z.coerce.number().int().min(1).max(24, "Kỳ đóng lãi không hợp lệ."),
  expectedPaidUntil: z.string().refine(isLocalDate, "Hợp đồng không hợp lệ."),
  amount: z
    .string()
    .max(30)
    .transform((text, ctx) => {
      const money = parseVnd(text);
      if (!money || !money.isPositive() || money.toBigInt() > MAX_PRINCIPAL) {
        ctx.addIssue({ code: "custom", message: "Số tiền khách đưa phải lớn hơn 0." });
        return z.NEVER;
      }
      return money;
    }),
});
