import { businessDate, type LocalDate } from "@/shared/kernel/local-date";
import { Money } from "@/shared/kernel/money";
import {
  dueStatus,
  dueThrough,
  endDate,
  isReversible,
  paymentOptions,
  periodsCovered,
  progress,
  schedulePeriods,
  type DueStatus,
  type PaymentOption,
  type Progress,
  type SchedulePeriod,
} from "../domain/installment";
import type { InstallmentDetailRow, InstallmentRepository, InstallmentTransaction, LatestOperation } from "./ports";

export type { DueStatus, PaymentOption, SchedulePeriod };

/** Số giao dịch hiện trên trang chi tiết (mới nhất trước). */
export const INSTALLMENT_HISTORY_LIMIT = 100;

/** Lịch góp thu gọn: vài kỳ trước và sau kỳ tới (mockup tra-gop-chi-tiet.html, "Xem đủ N kỳ"). */
const SCHEDULE_BEFORE = 3;
const SCHEDULE_AFTER = 2;

export type HistoryLine = InstallmentTransaction & {
  /** Kỳ mà lần thu chạm tới ("Góp kỳ 7–8"); chỉ có với lần thu chưa huỷ của thao tác đóng tiền góp. */
  periods: { first: number; last: number } | null;
};

export type InstallmentDetailView = {
  contract: InstallmentDetailRow;
  today: LocalDate;
  end: LocalDate;
  /** Tiền kỳ đầu ("Mỗi kỳ"). */
  perPeriod: Money;
  progress: Progress;
  schedule: SchedulePeriod[];
  /** Lịch đang hiện thu gọn (còn kỳ khác chưa hiện). */
  scheduleTruncated: boolean;
  history: HistoryLine[];
  /** Số lần thu chưa huỷ (xoá hợp đồng đảo từng lần). */
  paymentCount: number;
  /** Thao tác huỷ được (mới nhất chưa huỷ, không phải giải ngân); null nếu không có hoặc hợp đồng đã xoá. */
  reversible: LatestOperation | null;
  /** Chỉ khi hợp đồng đang góp, chưa xoá. */
  open: { dueStatus: DueStatus; paymentOptions: PaymentOption[] } | null;
};

export class GetInstallmentDetail {
  constructor(private readonly installments: InstallmentRepository) {}

  /** `shopId` lấy từ session (guard); hợp đồng của cửa hàng khác thì trả null. `fullSchedule` = hiện đủ mọi kỳ. */
  async execute(shopId: string, contractId: string, fullSchedule: boolean, now = new Date()): Promise<InstallmentDetailView | null> {
    const today = businessDate(now);
    const [contract, transactions, payments, latest] = await Promise.all([
      this.installments.findDetail(shopId, contractId),
      this.installments.listTransactions(shopId, contractId, INSTALLMENT_HISTORY_LIMIT),
      this.installments.listPayments(shopId, contractId),
      this.installments.findLatestOperation(shopId, contractId),
    ]);
    if (!contract) return null;
    const p = progress(contract, today);

    const center = p.next?.index ?? p.periods;
    const from = fullSchedule ? 1 : Math.max(1, center - SCHEDULE_BEFORE);
    const to = fullSchedule ? p.periods : Math.min(p.periods, Math.max(center + SCHEDULE_AFTER, from + SCHEDULE_BEFORE + SCHEDULE_AFTER));
    const schedule = schedulePeriods(
      contract,
      payments.map((x) => ({ on: x.on, amount: x.amount })),
      from,
      to,
    );

    // Nhãn kỳ: cộng dồn các lần thu chưa huỷ theo thứ tự ghi.
    const covered = new Map<string, { first: number; last: number }>();
    let before = Money.ZERO;
    for (const x of payments) {
      const after = before.add(x.amount);
      covered.set(x.id, periodsCovered(contract, before, after));
      before = after;
    }
    const history = transactions.map((t) => ({
      ...t,
      periods: t.type === "installment_payment" && t.operationKind === "pay" ? (covered.get(t.id) ?? null) : null,
    }));

    const open =
      contract.status === "active" && !contract.deleted
        ? { dueStatus: dueStatus(p, today), paymentOptions: paymentOptions(contract) }
        : null;
    return {
      contract,
      today,
      end: endDate(contract),
      perPeriod: dueThrough(contract, 1),
      progress: p,
      schedule,
      scheduleTruncated: from > 1 || to < p.periods,
      history,
      paymentCount: payments.length,
      reversible: latest && isReversible(latest.kind) ? latest : null,
      open,
    };
  }
}
