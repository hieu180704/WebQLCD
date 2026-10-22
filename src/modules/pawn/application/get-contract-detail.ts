import { addDays, businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import {
  accruedInterest,
  interestOptions,
  isReversible,
  nextInterestDue,
  upcomingPeriods,
  type InterestPeriod,
  type ScheduledPeriod,
} from "../domain/contract";
import { formatRate } from "../domain/interest/rate";
import type { ContractDetailRow, ContractRepository, ContractTransaction, LatestOperation } from "./ports";

/** Số giao dịch hiện trên trang chi tiết (mới nhất trước). */
export const CONTRACT_HISTORY_LIMIT = 100;

export type ContractDetailView = {
  contract: ContractDetailRow;
  rateText: string;
  today: LocalDate;
  /** Ngày hết hạn vay = ngày vay + số ngày vay. */
  termEnd: LocalDate;
  /** Các số dưới chỉ có khi hợp đồng đang mở. */
  open: {
    accruedInterest: Money;
    /** Gốc còn lại + lãi đến hôm nay. */
    payoff: Money;
    nextInterestDue: LocalDate;
    interestOptions: InterestPeriod[];
    schedule: ScheduledPeriod[];
  } | null;
  history: ContractTransaction[];
  /** Thao tác huỷ được (mới nhất chưa huỷ, không phải giải ngân); null nếu không có hoặc hợp đồng đã xoá. */
  reversible: LatestOperation | null;
};

export class GetContractDetail {
  constructor(private readonly contracts: ContractRepository) {}

  /** `shopId` lấy từ session (guard); hợp đồng của cửa hàng khác hoặc đã xoá thì trả null. */
  async execute(shopId: string, contractId: string, now = new Date()): Promise<ContractDetailView | null> {
    const today = businessDate(now);
    const [contract, history, latest] = await Promise.all([
      this.contracts.findDetail(shopId, contractId),
      this.contracts.listTransactions(shopId, contractId, CONTRACT_HISTORY_LIMIT),
      this.contracts.findLatestOperation(shopId, contractId),
    ]);
    if (!contract) return null;
    const reversible = latest && isReversible(latest.kind) ? latest : null;
    const termEnd = addDays(contract.loanDate, contract.termDays);
    let open: ContractDetailView["open"] = null;
    if (contract.status === "active" && !contract.deleted) {
      const accrued = accruedInterest(contract, today);
      open = {
        accruedInterest: accrued,
        payoff: contract.outstandingPrincipal.add(accrued),
        nextInterestDue: nextInterestDue(contract),
        interestOptions: interestOptions(contract, today),
        schedule: upcomingPeriods(contract, termEnd, today),
      };
    }
    return { contract, rateText: formatRate(contract.interestRate), today, termEnd, open, history, reversible };
  }
}
