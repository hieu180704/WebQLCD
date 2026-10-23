ALTER TABLE "shops" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_interest_type" "interest_type" DEFAULT 'per_million_per_day' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_interest_rate" numeric(9, 4);--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_term_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_interest_period_days" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_prepaid_interest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_name_not_blank" CHECK (btrim("shops"."name") <> '');--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_default_interest_rate_non_negative" CHECK ("shops"."default_interest_rate" >= 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_default_days" CHECK ("shops"."default_term_days" BETWEEN 1 AND 3650 AND "shops"."default_interest_period_days" BETWEEN 1 AND "shops"."default_term_days");