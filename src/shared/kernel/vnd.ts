import { Money } from "./money";

const formatter = new Intl.NumberFormat("vi-VN");

/** 5000000 → "5.000.000" (không kèm ký hiệu tiền). */
export function formatVnd(amount: Money): string {
  return formatter.format(amount.toBigInt());
}

// Dấu phân cách nghìn phải đúng nhóm 3 chữ số và dùng một loại duy nhất: "5.000,50" hay "1000000.5" bị từ chối
// thay vì bị đọc thành số lớn gấp 100 lần.
const GROUPED = /^\d{1,3}(?:([.,\s])\d{3}(?:\1\d{3})*)?$/;

/** "5.000.000", "5,000,000", "5 000 000", "5000000" → Money; số âm, số lẻ, chữ hoặc rỗng → null. */
export function parseVnd(text: string): Money | null {
  const value = text.trim();
  if (!/^\d+$/.test(value) && !GROUPED.test(value)) return null;
  const digits = value.replace(/[.,\s]/g, "");
  if (digits.length > 15) return null;
  return Money.of(BigInt(digits));
}
