import { addDays, businessDate, type LocalDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { progress } from "../domain/installment";
import type { DueInstallmentRow, InstallmentRepository } from "./ports";

/** Cùng cửa sổ "sắp đến hạn" ≤ 3 ngày và giới hạn dòng như `pawn.ListDueContracts` (core-spec mục 2). */
export const DUE_WINDOW_DAYS = 3;
export const DUE_LIST_LIMIT = 20;

export type DueInstallmentItem = Pick<DueInstallmentRow, "id" | "code" | "customerName"> & {
  /** Hạn kỳ tới (kỳ đầu chưa góp đủ); trước hôm nay là chậm góp. */
  due: LocalDate;
  /** Số còn thiếu của kỳ tới. */
  periodRemaining: Money;
};

export type DueInstallmentsView = { items: DueInstallmentItem[]; today: LocalDate };

export class ListDueInstallments {
  constructor(private readonly installments: InstallmentRepository) {}

  /** Đang góp, chậm góp hoặc kỳ tới đến hạn trong `DUE_WINDOW_DAYS` ngày tới, hạn sớm nhất trước. `shopId` lấy từ session. */
  async execute(shopId: string, now = new Date()): Promise<DueInstallmentsView> {
    const today = businessDate(now);
    const rows = await this.installments.listDue(shopId, addDays(today, DUE_WINDOW_DAYS), DUE_LIST_LIMIT);
    const items = rows.flatMap((row) => {
      const next = progress(row, today).next;
      // Hàng lọc ra đều chưa góp đủ nên luôn có kỳ tới (hàm SQL installment_next_due khớp domain).
      return next ? [{ id: row.id, code: row.code, customerName: row.customerName, due: next.due, periodRemaining: next.remaining }] : [];
    });
    return { items, today };
  }
}
