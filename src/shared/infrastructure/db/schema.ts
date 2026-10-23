// Schema PostgreSQL. Đặc tả: Docs/SourceOfTruth/Core/data-model.txt (sửa schema thì sửa doc cùng lúc).
// Trigger append-only, kiểm tra reversal và extension pg_trgm nằm trong migration SQL viết tay ở drizzle/.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => bigint(name, { mode: "bigint" });

export const subscriptionStatus = pgEnum("subscription_status", ["trial", "active", "expired"]);
export const userRole = pgEnum("user_role", ["owner", "staff"]);
export const contractKind = pgEnum("contract_kind", ["secured", "unsecured"]);
export const interestType = pgEnum("interest_type", [
  "per_million_per_day",
  "percent_per_month",
  "percent_per_week",
]);
export const contractStatus = pgEnum("contract_status", ["active", "closed"]);
export const contractOperationKind = pgEnum("contract_operation_kind", [
  "disbursement",
  "pay_interest",
  "repay_principal",
  "additional_loan",
  "extend",
  "close",
]);
export const installmentOperationKind = pgEnum("installment_operation_kind", ["disbursement", "pay", "close"]);
export const cashTransactionType = pgEnum("cash_transaction_type", [
  "opening_balance",
  "capital_in",
  "manual_income",
  "manual_expense",
  "disbursement",
  "additional_loan",
  "interest_payment",
  "principal_repayment",
  "installment_disbursement",
  "installment_payment",
  "reversal",
]);

export const shops = pgTable(
  "shops",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    openedAt: date("opened_at", { mode: "string" }).notNull(),
    subscriptionStatus: subscriptionStatus("subscription_status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
    paidUntil: timestamp("paid_until", { withTimezone: true }),
    // Giá trị điền sẵn vào form tạo hợp đồng cầm đồ/tín chấp; lãi null = không điền sẵn.
    defaultInterestType: interestType("default_interest_type").notNull().default("per_million_per_day"),
    defaultInterestRate: numeric("default_interest_rate", { precision: 9, scale: 4 }),
    defaultTermDays: integer("default_term_days").notNull().default(30),
    defaultInterestPeriodDays: integer("default_interest_period_days").notNull().default(10),
    defaultPrepaidInterest: boolean("default_prepaid_interest").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shops_name_not_blank", sql`btrim(${t.name}) <> ''`),
    check("shops_default_interest_rate_non_negative", sql`${t.defaultInterestRate} >= 0`),
    check(
      "shops_default_days",
      sql`${t.defaultTermDays} BETWEEN 1 AND 3650 AND ${t.defaultInterestPeriodDays} BETWEEN 1 AND ${t.defaultTermDays}`,
    ),
  ],
);

// Bốn bảng users/sessions/accounts/verifications theo hình dạng Better Auth yêu cầu (mật khẩu ở accounts.password).
export const users = pgTable(
  "users",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    username: text("username").notNull(),
    displayUsername: text("display_username"),
    role: userRole("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Ghi ở hook tạo phiên của Better Auth (auth.ts); sessions bị xoá khi đăng xuất/khoá nên không suy ra từ đó được.
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("users_shop_id_id_key").on(t.shopId, t.id),
    uniqueIndex("users_username_lower_key").on(sql`lower(${t.username})`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// Đếm lần đăng nhập theo IP và theo username (kể cả username không tồn tại), và lần đăng ký theo IP; trước khi biết cửa hàng nên không có shop_id.
export const loginThrottles = pgTable(
  "login_throttles",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    attempts: integer("attempts").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    check("login_throttles_scope", sql`${t.scope} IN ('ip', 'user', 'signup')`),
    check("login_throttles_attempts_non_negative", sql`${t.attempts} >= 0`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    address: text("address"),
    cccdEncrypted: text("cccd_encrypted"),
    cccdHash: text("cccd_hash"),
    cccdMasked: text("cccd_masked"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_shop_id_id_key").on(t.shopId, t.id),
    uniqueIndex("customers_shop_id_cccd_hash_key")
      .on(t.shopId, t.cccdHash)
      .where(sql`${t.cccdHash} IS NOT NULL`),
    check(
      "customers_cccd_columns_together",
      sql`num_nonnulls(${t.cccdEncrypted}, ${t.cccdHash}, ${t.cccdMasked}) IN (0, 3)`,
    ),
    // Tìm tên không dấu, không phân biệt hoa thường; hàm search_text tạo ở migration 0007.
    index("customers_full_name_search_trgm_idx").using("gin", sql`search_text(${t.fullName}) gin_trgm_ops`),
    index("customers_phone_trgm_idx").using("gin", t.phone.op("gin_trgm_ops")),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    code: text("code").notNull(),
    customerId: uuid("customer_id").notNull(),
    kind: contractKind("kind").notNull(),
    assetName: text("asset_name"),
    principal: money("principal").notNull(),
    outstandingPrincipal: money("outstanding_principal").notNull(),
    interestType: interestType("interest_type").notNull(),
    interestRate: numeric("interest_rate", { precision: 9, scale: 4 }).notNull(),
    interestPeriodDays: integer("interest_period_days").notNull(),
    termDays: integer("term_days").notNull(),
    loanDate: date("loan_date", { mode: "string" }).notNull(),
    interestPaidUntil: date("interest_paid_until", { mode: "string" }).notNull(),
    prepaidInterest: boolean("prepaid_interest").notNull().default(false),
    status: contractStatus("status").notNull().default("active"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    note: text("note"),
    staffId: uuid("staff_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deletedReason: text("deleted_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("contracts_shop_id_id_key").on(t.shopId, t.id),
    unique("contracts_shop_id_code_key").on(t.shopId, t.code),
    foreignKey({
      name: "contracts_customer_fk",
      columns: [t.shopId, t.customerId],
      foreignColumns: [customers.shopId, customers.id],
    }),
    foreignKey({
      name: "contracts_staff_fk",
      columns: [t.shopId, t.staffId],
      foreignColumns: [users.shopId, users.id],
    }),
    foreignKey({
      name: "contracts_deleted_by_fk",
      columns: [t.shopId, t.deletedBy],
      foreignColumns: [users.shopId, users.id],
    }),
    check(
      "contracts_secured_requires_asset",
      sql`${t.kind} <> 'secured' OR btrim(coalesce(${t.assetName}, '')) <> ''`,
    ),
    check("contracts_principal_positive", sql`${t.principal} > 0`),
    check("contracts_outstanding_non_negative", sql`${t.outstandingPrincipal} >= 0`),
    check("contracts_interest_rate_non_negative", sql`${t.interestRate} >= 0`),
    check("contracts_days_positive", sql`${t.interestPeriodDays} > 0 AND ${t.termDays} > 0`),
    check("contracts_closed_at_matches_status", sql`(${t.status} = 'closed') = (${t.closedAt} IS NOT NULL)`),
    check("contracts_deleted_together", sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
    check(
      "contracts_deleted_reason",
      sql`(${t.deletedAt} IS NULL) = (${t.deletedReason} IS NULL) AND btrim(coalesce(${t.deletedReason}, 'x')) <> ''`,
    ),
    index("contracts_shop_status_paid_until_idx").on(t.shopId, t.status, t.interestPaidUntil),
    index("contracts_shop_customer_idx").on(t.shopId, t.customerId),
    index("contracts_code_trgm_idx").using("gin", t.code.op("gin_trgm_ops")),
    // Tìm tài sản không dấu như tên khách (search_text, migration 0007).
    index("contracts_asset_name_search_trgm_idx").using("gin", sql`search_text(${t.assetName}) gin_trgm_ops`),
  ],
);

export const installmentContracts = pgTable(
  "installment_contracts",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    code: text("code").notNull(),
    customerId: uuid("customer_id").notNull(),
    amountGiven: money("amount_given").notNull(),
    totalDue: money("total_due").notNull(),
    totalDays: integer("total_days").notNull(),
    periodDays: integer("period_days").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    amountPaid: money("amount_paid").notNull().default(sql`0`),
    status: contractStatus("status").notNull().default("active"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    note: text("note"),
    staffId: uuid("staff_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deletedReason: text("deleted_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("installment_contracts_shop_id_id_key").on(t.shopId, t.id),
    unique("installment_contracts_shop_id_code_key").on(t.shopId, t.code),
    foreignKey({
      name: "installment_contracts_customer_fk",
      columns: [t.shopId, t.customerId],
      foreignColumns: [customers.shopId, customers.id],
    }),
    foreignKey({
      name: "installment_contracts_staff_fk",
      columns: [t.shopId, t.staffId],
      foreignColumns: [users.shopId, users.id],
    }),
    foreignKey({
      name: "installment_contracts_deleted_by_fk",
      columns: [t.shopId, t.deletedBy],
      foreignColumns: [users.shopId, users.id],
    }),
    check("installment_contracts_amounts", sql`${t.totalDue} >= ${t.amountGiven} AND ${t.amountGiven} > 0`),
    check("installment_contracts_amount_paid_non_negative", sql`${t.amountPaid} >= 0`),
    check(
      "installment_contracts_days",
      sql`${t.totalDays} > 0 AND ${t.periodDays} > 0 AND ${t.periodDays} <= ${t.totalDays}`,
    ),
    check(
      "installment_contracts_closed_at_matches_status",
      sql`(${t.status} = 'closed') = (${t.closedAt} IS NOT NULL)`,
    ),
    check("installment_contracts_deleted_together", sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
    check(
      "installment_contracts_deleted_reason",
      sql`(${t.deletedAt} IS NULL) = (${t.deletedReason} IS NULL) AND btrim(coalesce(${t.deletedReason}, 'x')) <> ''`,
    ),
    index("installment_contracts_shop_status_idx").on(t.shopId, t.status),
    index("installment_contracts_shop_customer_idx").on(t.shopId, t.customerId),
    index("installment_contracts_code_trgm_idx").using("gin", t.code.op("gin_trgm_ops")),
  ],
);

/**
 * Thao tác trên hợp đồng trả góp (data-model mục 3.5a), cùng cách với `contract_operations`: `id` = `operation_id` của các
 * dòng sổ két sinh ra (tất toán thu 0 đồng thì không có dòng nào). Huỷ = đánh dấu `reversed_*` và đảo các dòng chung id.
 */
export const installmentOperations = pgTable(
  "installment_operations",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    installmentContractId: uuid("installment_contract_id").notNull(),
    kind: installmentOperationKind("kind").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reverseReason: text("reverse_reason"),
  },
  (t) => [
    unique("installment_operations_shop_id_id_key").on(t.shopId, t.id),
    foreignKey({
      name: "installment_operations_contract_fk",
      columns: [t.shopId, t.installmentContractId],
      foreignColumns: [installmentContracts.shopId, installmentContracts.id],
    }),
    foreignKey({
      name: "installment_operations_created_by_fk",
      columns: [t.shopId, t.createdBy],
      foreignColumns: [users.shopId, users.id],
    }),
    foreignKey({
      name: "installment_operations_reversed_by_fk",
      columns: [t.shopId, t.reversedBy],
      foreignColumns: [users.shopId, users.id],
    }),
    check(
      "installment_operations_reversed_together",
      sql`num_nonnulls(${t.reversedAt}, ${t.reversedBy}, ${t.reverseReason}) IN (0, 3) AND btrim(coalesce(${t.reverseReason}, 'x')) <> ''`,
    ),
    check("installment_operations_disbursement_not_reversed", sql`${t.kind} <> 'disbursement' OR ${t.reversedAt} IS NULL`),
    // Thao tác mới nhất của hợp đồng.
    index("installment_operations_shop_contract_created_idx").on(t.shopId, t.installmentContractId, t.createdAt),
  ],
);

/**
 * Thao tác trên hợp đồng cầm đồ/tín chấp (data-model mục 3.6a). `id` = `operation_id` của các dòng sổ két sinh ra
 * (gia hạn không thu lãi thì không có dòng nào). Huỷ = đánh dấu `reversed_*` và đảo các dòng sổ két chung id.
 */
export const contractOperations = pgTable(
  "contract_operations",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    contractId: uuid("contract_id").notNull(),
    kind: contractOperationKind("kind").notNull(),
    /** Số ngày cộng thêm khi gia hạn; huỷ gia hạn trừ lại. */
    extraDays: integer("extra_days"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reverseReason: text("reverse_reason"),
  },
  (t) => [
    unique("contract_operations_shop_id_id_key").on(t.shopId, t.id),
    foreignKey({
      name: "contract_operations_contract_fk",
      columns: [t.shopId, t.contractId],
      foreignColumns: [contracts.shopId, contracts.id],
    }),
    foreignKey({
      name: "contract_operations_created_by_fk",
      columns: [t.shopId, t.createdBy],
      foreignColumns: [users.shopId, users.id],
    }),
    foreignKey({
      name: "contract_operations_reversed_by_fk",
      columns: [t.shopId, t.reversedBy],
      foreignColumns: [users.shopId, users.id],
    }),
    check("contract_operations_extra_days", sql`(${t.kind} = 'extend') = (${t.extraDays} IS NOT NULL) AND coalesce(${t.extraDays}, 1) > 0`),
    check(
      "contract_operations_reversed_together",
      sql`num_nonnulls(${t.reversedAt}, ${t.reversedBy}, ${t.reverseReason}) IN (0, 3) AND btrim(coalesce(${t.reverseReason}, 'x')) <> ''`,
    ),
    check("contract_operations_disbursement_not_reversed", sql`${t.kind} <> 'disbursement' OR ${t.reversedAt} IS NULL`),
    // Thao tác mới nhất của hợp đồng.
    index("contract_operations_shop_contract_created_idx").on(t.shopId, t.contractId, t.createdAt),
  ],
);

export const cashTransactions = pgTable(
  "cash_transactions",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    operationId: uuid("operation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    type: cashTransactionType("type").notNull(),
    contractId: uuid("contract_id"),
    installmentContractId: uuid("installment_contract_id"),
    periodFrom: date("period_from", { mode: "string" }),
    periodTo: date("period_to", { mode: "string" }),
    reversesId: uuid("reverses_id").unique(),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
  },
  (t) => [
    unique("cash_transactions_shop_id_id_key").on(t.shopId, t.id),
    foreignKey({
      name: "cash_transactions_contract_fk",
      columns: [t.shopId, t.contractId],
      foreignColumns: [contracts.shopId, contracts.id],
    }),
    foreignKey({
      name: "cash_transactions_installment_contract_fk",
      columns: [t.shopId, t.installmentContractId],
      foreignColumns: [installmentContracts.shopId, installmentContracts.id],
    }),
    foreignKey({
      name: "cash_transactions_reverses_fk",
      columns: [t.shopId, t.reversesId],
      foreignColumns: [t.shopId, t.id],
    }),
    foreignKey({
      name: "cash_transactions_created_by_fk",
      columns: [t.shopId, t.createdBy],
      foreignColumns: [users.shopId, users.id],
    }),
    check("cash_transactions_amount_non_zero", sql`${t.amount} <> 0`),
    check("cash_transactions_reversal_has_target", sql`(${t.type} = 'reversal') = (${t.reversesId} IS NOT NULL)`),
    // Dấu tiền và đối tượng gắn kèm theo type; reversal kiểm bằng trigger (phải so với dòng gốc).
    check(
      "cash_transactions_type_rules",
      sql`CASE ${t.type}
        WHEN 'opening_balance' THEN ${t.amount} > 0 AND num_nonnulls(${t.contractId}, ${t.installmentContractId}) = 0
        WHEN 'capital_in' THEN ${t.amount} > 0 AND num_nonnulls(${t.contractId}, ${t.installmentContractId}) = 0
        WHEN 'manual_income' THEN ${t.amount} > 0 AND num_nonnulls(${t.contractId}, ${t.installmentContractId}) = 0
        WHEN 'manual_expense' THEN ${t.amount} < 0 AND num_nonnulls(${t.contractId}, ${t.installmentContractId}) = 0
        WHEN 'disbursement' THEN ${t.amount} < 0 AND ${t.contractId} IS NOT NULL AND ${t.installmentContractId} IS NULL
        WHEN 'additional_loan' THEN ${t.amount} < 0 AND ${t.contractId} IS NOT NULL AND ${t.installmentContractId} IS NULL
        WHEN 'interest_payment' THEN ${t.amount} > 0 AND ${t.contractId} IS NOT NULL AND ${t.installmentContractId} IS NULL
        WHEN 'principal_repayment' THEN ${t.amount} > 0 AND ${t.contractId} IS NOT NULL AND ${t.installmentContractId} IS NULL
        WHEN 'installment_disbursement' THEN ${t.amount} < 0 AND ${t.contractId} IS NULL AND ${t.installmentContractId} IS NOT NULL
        WHEN 'installment_payment' THEN ${t.amount} > 0 AND ${t.contractId} IS NULL AND ${t.installmentContractId} IS NOT NULL
        WHEN 'reversal' THEN num_nonnulls(${t.contractId}, ${t.installmentContractId}) <= 1
      END`,
    ),
    check(
      "cash_transactions_interest_period",
      sql`CASE WHEN ${t.type} = 'interest_payment'
        THEN ${t.periodFrom} IS NOT NULL AND ${t.periodTo} IS NOT NULL AND ${t.periodTo} >= ${t.periodFrom}
        WHEN ${t.type} = 'reversal' THEN true
        ELSE ${t.periodFrom} IS NULL AND ${t.periodTo} IS NULL END`,
    ),
    index("cash_transactions_shop_business_date_idx").on(t.shopId, t.businessDate),
    index("cash_transactions_shop_contract_idx").on(t.shopId, t.contractId),
    index("cash_transactions_shop_installment_contract_idx").on(t.shopId, t.installmentContractId),
    index("cash_transactions_shop_operation_idx").on(t.shopId, t.operationId),
    // Mỗi cửa hàng một dòng quỹ đầu két; dòng gốc vẫn còn sau khi bị đảo nên nhập lại phải dùng capital_in.
    uniqueIndex("cash_transactions_one_opening_balance_key")
      .on(t.shopId)
      .where(sql`${t.type} = 'opening_balance'`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    userId: uuid("user_id").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    changedFields: text("changed_fields").array().notNull().default(sql`'{}'`),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "audit_logs_user_fk",
      columns: [t.shopId, t.userId],
      foreignColumns: [users.shopId, users.id],
    }),
    index("audit_logs_shop_entity_idx").on(t.shopId, t.entity, t.entityId),
  ],
);

export const shopCounters = pgTable(
  "shop_counters",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    prefix: text("prefix").notNull(),
    nextValue: bigint("next_value", { mode: "bigint" }).notNull().default(sql`1`),
  },
  (t) => [
    primaryKey({ columns: [t.shopId, t.prefix] }),
    check("shop_counters_prefix", sql`${t.prefix} IN ('CD-', 'TC-', 'TG-')`),
    check("shop_counters_next_value_positive", sql`${t.nextValue} > 0`),
  ],
);
