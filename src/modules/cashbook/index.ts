// Public API của module cashbook. Module khác chỉ được import qua file này.
export type { CashEntry } from "./domain/cash-entry";
// Module khác chỉ dùng kiểu; hàm ghi sổ được ghép qua composition-root (tránh vòng import qua presentation).
export type { AppendCashEntries, CashOperation } from "./infrastructure/cash-ledger";
export { CashbookPage } from "./presentation/cashbook-page";
export { CashLineList, CashSummary } from "./presentation/cash-summary";
