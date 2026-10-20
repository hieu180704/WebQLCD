// Public API của module customer. Module khác chỉ được import qua file này.
export type { NewCustomer, ResolvedCustomer } from "./domain/customer";
export { maskPhone, normalizeCccd, normalizePhone } from "./domain/personal-data";
export { CccdCipher } from "./infrastructure/cccd-cipher";
export { DrizzleCustomerWriter } from "./infrastructure/drizzle-customer-writer";
