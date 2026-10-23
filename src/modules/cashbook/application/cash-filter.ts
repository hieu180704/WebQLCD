import type { CashTransactionType } from "./ports";

/**
 * Nhóm loại giao dịch để lọc sổ quỹ (mockup quy-ket). Khoá là giá trị tham số `loai` trên URL.
 */
export const CASH_TYPE_GROUPS = {
  "giai-ngan": { label: "Giải ngân / vay thêm", types: ["disbursement", "additional_loan"] },
  "dong-lai": { label: "Đóng lãi", types: ["interest_payment"] },
  "tra-goc": { label: "Trả gốc / chuộc đồ", types: ["principal_repayment"] },
  "tra-gop": { label: "Trả góp (giải ngân / thu góp)", types: ["installment_disbursement", "installment_payment"] },
  "thu-khac": { label: "Thu khác", types: ["manual_income"] },
  "chi-khac": { label: "Chi khác", types: ["manual_expense"] },
  "nap-von": { label: "Nạp vốn / quỹ đầu két", types: ["capital_in", "opening_balance"] },
  dao: { label: "Bút toán đảo", types: ["reversal"] },
} as const satisfies Record<string, { label: string; types: readonly CashTransactionType[] }>;

export type CashTypeGroup = keyof typeof CASH_TYPE_GROUPS;

export const isCashTypeGroup = (value: string): value is CashTypeGroup => Object.hasOwn(CASH_TYPE_GROUPS, value);

/** Bộ lọc danh sách giao dịch; bỏ trống = tất cả. Không ảnh hưởng 4 ô tổng két. */
export type CashLineFilter = { group?: CashTypeGroup | null; createdBy?: string | null };
