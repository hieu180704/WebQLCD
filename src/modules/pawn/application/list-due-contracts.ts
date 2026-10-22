import { addDays, businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { interestPerPeriod, nextInterestDue } from "../domain/contract";
import type { ContractRepository, DueContractRow } from "./ports";

/** "Sắp đến hạn" = hạn đóng lãi trong ≤ 3 ngày tới (core-spec mục 2). */
export const DUE_WINDOW_DAYS = 3;
export const DUE_LIST_LIMIT = 20;

export type DueContractItem = Pick<DueContractRow, "id" | "code" | "customerName" | "kind"> & {
  due: LocalDate;
  /** Lãi một kỳ trên gốc còn lại. */
  periodInterest: Money;
};

export type DueContractsView = { items: DueContractItem[]; today: LocalDate };

export class ListDueContracts {
  constructor(private readonly contracts: ContractRepository) {}

  /** Quá hạn hoặc đến hạn trong `DUE_WINDOW_DAYS` ngày tới, hạn sớm nhất trước. `shopId` lấy từ session. */
  async execute(shopId: string, now = new Date()): Promise<DueContractsView> {
    const today = businessDate(now);
    const rows = await this.contracts.listDue(shopId, addDays(today, DUE_WINDOW_DAYS), DUE_LIST_LIMIT);
    const items = rows.map((row) => ({
      id: row.id,
      code: row.code,
      customerName: row.customerName,
      kind: row.kind,
      due: nextInterestDue(row),
      periodInterest: interestPerPeriod(row),
    }));
    return { items, today };
  }
}
