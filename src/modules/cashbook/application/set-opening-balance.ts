import type { Money } from "@/shared/kernel/money";
import type { Actor, CashbookRepository, OpeningBalanceResult } from "./ports";

export type SetOpeningBalanceResult = OpeningBalanceResult | "not_positive";

/** Nhập quỹ đầu két (chỉ chủ tiệm, guard kiểm ở presentation). Nhập sai thì bổ sung bằng nghiệp vụ khác sau này. */
export class SetOpeningBalance {
  constructor(private readonly cashbook: CashbookRepository) {}

  async execute(actor: Actor, amount: Money): Promise<SetOpeningBalanceResult> {
    if (!amount.isPositive()) return "not_positive";
    return this.cashbook.recordOpeningBalance(actor, amount);
  }
}
