// Tính xem trước cho form tạo hợp đồng trả góp (chạy cả ở trình duyệt): số kỳ, tiền mỗi kỳ, cảnh báo lãi.
// Chỉ để hiển thị; server tính lại khi lưu (CreateInstallment), không nhận số tiền đã tính từ client.
import type { LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import {
  annualPercent,
  dueThrough,
  endDate,
  periodCount,
  periodDueDate,
  rateWarning,
  type InstallmentTerms,
  type RateWarning,
} from "../domain/installment";

export type { RateWarning };

export type InstallmentPreview = {
  periods: number;
  /** Tiền kỳ đầu; các kỳ chênh nhau tối đa 1 đồng do làm tròn. */
  perPeriod: Money;
  profit: Money;
  firstDue: LocalDate;
  end: LocalDate;
  annualPercent: number;
  warning: RateWarning;
};

export function previewInstallment(terms: InstallmentTerms): InstallmentPreview {
  return {
    periods: periodCount(terms),
    perPeriod: dueThrough(terms, 1),
    profit: terms.totalDue.subtract(terms.amountGiven),
    firstDue: periodDueDate(terms, 1),
    end: endDate(terms),
    annualPercent: annualPercent(terms),
    warning: rateWarning(terms),
  };
}
