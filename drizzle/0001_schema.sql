CREATE TYPE "public"."cash_transaction_type" AS ENUM('opening_balance', 'capital_in', 'manual_income', 'manual_expense', 'disbursement', 'additional_loan', 'interest_payment', 'principal_repayment', 'installment_disbursement', 'installment_payment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."contract_kind" AS ENUM('secured', 'unsecured');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."interest_type" AS ENUM('per_million_per_day', 'percent_per_month', 'percent_per_week');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changed_fields" text[] DEFAULT '{}' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"type" "cash_transaction_type" NOT NULL,
	"contract_id" uuid,
	"installment_contract_id" uuid,
	"period_from" date,
	"period_to" date,
	"reverses_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	CONSTRAINT "cash_transactions_reverses_id_unique" UNIQUE("reverses_id"),
	CONSTRAINT "cash_transactions_shop_id_id_key" UNIQUE("shop_id","id"),
	CONSTRAINT "cash_transactions_amount_non_zero" CHECK ("cash_transactions"."amount" <> 0),
	CONSTRAINT "cash_transactions_reversal_has_target" CHECK (("cash_transactions"."type" = 'reversal') = ("cash_transactions"."reverses_id" IS NOT NULL)),
	CONSTRAINT "cash_transactions_type_rules" CHECK (CASE "cash_transactions"."type"
        WHEN 'opening_balance' THEN "cash_transactions"."amount" > 0 AND num_nonnulls("cash_transactions"."contract_id", "cash_transactions"."installment_contract_id") = 0
        WHEN 'capital_in' THEN "cash_transactions"."amount" > 0 AND num_nonnulls("cash_transactions"."contract_id", "cash_transactions"."installment_contract_id") = 0
        WHEN 'manual_income' THEN "cash_transactions"."amount" > 0 AND num_nonnulls("cash_transactions"."contract_id", "cash_transactions"."installment_contract_id") = 0
        WHEN 'manual_expense' THEN "cash_transactions"."amount" < 0 AND num_nonnulls("cash_transactions"."contract_id", "cash_transactions"."installment_contract_id") = 0
        WHEN 'disbursement' THEN "cash_transactions"."amount" < 0 AND "cash_transactions"."contract_id" IS NOT NULL AND "cash_transactions"."installment_contract_id" IS NULL
        WHEN 'additional_loan' THEN "cash_transactions"."amount" < 0 AND "cash_transactions"."contract_id" IS NOT NULL AND "cash_transactions"."installment_contract_id" IS NULL
        WHEN 'interest_payment' THEN "cash_transactions"."amount" > 0 AND "cash_transactions"."contract_id" IS NOT NULL AND "cash_transactions"."installment_contract_id" IS NULL
        WHEN 'principal_repayment' THEN "cash_transactions"."amount" > 0 AND "cash_transactions"."contract_id" IS NOT NULL AND "cash_transactions"."installment_contract_id" IS NULL
        WHEN 'installment_disbursement' THEN "cash_transactions"."amount" < 0 AND "cash_transactions"."contract_id" IS NULL AND "cash_transactions"."installment_contract_id" IS NOT NULL
        WHEN 'installment_payment' THEN "cash_transactions"."amount" > 0 AND "cash_transactions"."contract_id" IS NULL AND "cash_transactions"."installment_contract_id" IS NOT NULL
        WHEN 'reversal' THEN num_nonnulls("cash_transactions"."contract_id", "cash_transactions"."installment_contract_id") <= 1
      END),
	CONSTRAINT "cash_transactions_interest_period" CHECK (CASE WHEN "cash_transactions"."type" = 'interest_payment'
        THEN "cash_transactions"."period_from" IS NOT NULL AND "cash_transactions"."period_to" IS NOT NULL AND "cash_transactions"."period_to" >= "cash_transactions"."period_from"
        WHEN "cash_transactions"."type" = 'reversal' THEN true
        ELSE "cash_transactions"."period_from" IS NULL AND "cash_transactions"."period_to" IS NULL END)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "contract_kind" NOT NULL,
	"asset_name" text,
	"principal" bigint NOT NULL,
	"outstanding_principal" bigint NOT NULL,
	"interest_type" "interest_type" NOT NULL,
	"interest_rate" numeric(9, 4) NOT NULL,
	"interest_period_days" integer NOT NULL,
	"term_days" integer NOT NULL,
	"loan_date" date NOT NULL,
	"interest_paid_until" date NOT NULL,
	"prepaid_interest" boolean DEFAULT false NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"note" text,
	"staff_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_shop_id_id_key" UNIQUE("shop_id","id"),
	CONSTRAINT "contracts_shop_id_code_key" UNIQUE("shop_id","code"),
	CONSTRAINT "contracts_secured_requires_asset" CHECK ("contracts"."kind" <> 'secured' OR btrim(coalesce("contracts"."asset_name", '')) <> ''),
	CONSTRAINT "contracts_principal_positive" CHECK ("contracts"."principal" > 0),
	CONSTRAINT "contracts_outstanding_non_negative" CHECK ("contracts"."outstanding_principal" >= 0),
	CONSTRAINT "contracts_interest_rate_non_negative" CHECK ("contracts"."interest_rate" >= 0),
	CONSTRAINT "contracts_days_positive" CHECK ("contracts"."interest_period_days" > 0 AND "contracts"."term_days" > 0),
	CONSTRAINT "contracts_closed_at_matches_status" CHECK (("contracts"."status" = 'closed') = ("contracts"."closed_at" IS NOT NULL)),
	CONSTRAINT "contracts_deleted_together" CHECK (("contracts"."deleted_at" IS NULL) = ("contracts"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"address" text,
	"cccd_encrypted" text,
	"cccd_hash" text,
	"cccd_masked" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_shop_id_id_key" UNIQUE("shop_id","id"),
	CONSTRAINT "customers_cccd_columns_together" CHECK (num_nonnulls("customers"."cccd_encrypted", "customers"."cccd_hash", "customers"."cccd_masked") IN (0, 3))
);
--> statement-breakpoint
CREATE TABLE "installment_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"code" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_given" bigint NOT NULL,
	"total_due" bigint NOT NULL,
	"total_days" integer NOT NULL,
	"period_days" integer NOT NULL,
	"start_date" date NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"note" text,
	"staff_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_contracts_shop_id_id_key" UNIQUE("shop_id","id"),
	CONSTRAINT "installment_contracts_shop_id_code_key" UNIQUE("shop_id","code"),
	CONSTRAINT "installment_contracts_amounts" CHECK ("installment_contracts"."total_due" >= "installment_contracts"."amount_given" AND "installment_contracts"."amount_given" > 0),
	CONSTRAINT "installment_contracts_amount_paid_non_negative" CHECK ("installment_contracts"."amount_paid" >= 0),
	CONSTRAINT "installment_contracts_days" CHECK ("installment_contracts"."total_days" > 0 AND "installment_contracts"."period_days" > 0 AND "installment_contracts"."period_days" <= "installment_contracts"."total_days"),
	CONSTRAINT "installment_contracts_closed_at_matches_status" CHECK (("installment_contracts"."status" = 'closed') = ("installment_contracts"."closed_at" IS NOT NULL)),
	CONSTRAINT "installment_contracts_deleted_together" CHECK (("installment_contracts"."deleted_at" IS NULL) = ("installment_contracts"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "shop_counters" (
	"shop_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "shop_counters_shop_id_prefix_pk" PRIMARY KEY("shop_id","prefix"),
	CONSTRAINT "shop_counters_prefix" CHECK ("shop_counters"."prefix" IN ('CD-', 'TC-', 'TG-')),
	CONSTRAINT "shop_counters_next_value_positive" CHECK ("shop_counters"."next_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"opened_at" date NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"paid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text NOT NULL,
	"display_username" text,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_shop_id_id_key" UNIQUE("shop_id","id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_fk" FOREIGN KEY ("shop_id","user_id") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_contract_fk" FOREIGN KEY ("shop_id","contract_id") REFERENCES "public"."contracts"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_installment_contract_fk" FOREIGN KEY ("shop_id","installment_contract_id") REFERENCES "public"."installment_contracts"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_reverses_fk" FOREIGN KEY ("shop_id","reverses_id") REFERENCES "public"."cash_transactions"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_created_by_fk" FOREIGN KEY ("shop_id","created_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_fk" FOREIGN KEY ("shop_id","customer_id") REFERENCES "public"."customers"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_staff_fk" FOREIGN KEY ("shop_id","staff_id") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deleted_by_fk" FOREIGN KEY ("shop_id","deleted_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_contracts" ADD CONSTRAINT "installment_contracts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_contracts" ADD CONSTRAINT "installment_contracts_customer_fk" FOREIGN KEY ("shop_id","customer_id") REFERENCES "public"."customers"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_contracts" ADD CONSTRAINT "installment_contracts_staff_fk" FOREIGN KEY ("shop_id","staff_id") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_contracts" ADD CONSTRAINT "installment_contracts_deleted_by_fk" FOREIGN KEY ("shop_id","deleted_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_counters" ADD CONSTRAINT "shop_counters_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_shop_entity_idx" ON "audit_logs" USING btree ("shop_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_shop_business_date_idx" ON "cash_transactions" USING btree ("shop_id","business_date");--> statement-breakpoint
CREATE INDEX "cash_transactions_shop_contract_idx" ON "cash_transactions" USING btree ("shop_id","contract_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_shop_installment_contract_idx" ON "cash_transactions" USING btree ("shop_id","installment_contract_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_shop_operation_idx" ON "cash_transactions" USING btree ("shop_id","operation_id");--> statement-breakpoint
CREATE INDEX "contracts_shop_status_paid_until_idx" ON "contracts" USING btree ("shop_id","status","interest_paid_until");--> statement-breakpoint
CREATE INDEX "contracts_code_trgm_idx" ON "contracts" USING gin ("code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contracts_asset_name_trgm_idx" ON "contracts" USING gin ("asset_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "customers_shop_id_cccd_hash_key" ON "customers" USING btree ("shop_id","cccd_hash") WHERE "customers"."cccd_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_full_name_trgm_idx" ON "customers" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customers_phone_trgm_idx" ON "customers" USING gin ("phone" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "installment_contracts_shop_status_idx" ON "installment_contracts" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "installment_contracts_code_trgm_idx" ON "installment_contracts" USING gin ("code" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");