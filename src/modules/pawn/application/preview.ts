// Tính xem trước cho form tạo hợp đồng (chạy cả ở trình duyệt): cảnh báo lãi suất, lãi trước, tiền giao khách.
// Chỉ để hiển thị; server tính lại khi lưu (CreateContract), không nhận số tiền đã tính từ client.
import { Money } from "@/shared/kernel/money";
import { interestPolicy, type InterestType } from "../domain/interest/interest-policy";
import { annualPercent, parseRate, rateWarning, type RateWarning } from "../domain/interest/rate";

export type { InterestType, RateWarning };
export { parseRate };

export type ContractPreview = {
  annualPercent: number;
  warning: RateWarning;
  /** Lãi một kỳ trên số tiền vay. */
  periodInterest: Money;
  /** Tiền giao khách: trừ lãi kỳ đầu nếu thu lãi trước. */
  cashToCustomer: Money;
};

export function previewContract(input: {
  principal: Money;
  interestType: InterestType;
  rate: bigint;
  periodDays: number;
  prepaidInterest: boolean;
}): ContractPreview {
  const periodInterest = interestPolicy(input.interestType).interestFor(input.principal, input.rate, input.periodDays);
  return {
    annualPercent: annualPercent(input.interestType, input.rate),
    warning: rateWarning(input.interestType, input.rate),
    periodInterest,
    cashToCustomer: input.prepaidInterest ? input.principal.subtract(periodInterest) : input.principal,
  };
}
