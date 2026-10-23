CREATE TYPE "public"."installment_operation_kind" AS ENUM('disbursement', 'pay', 'close');--> statement-breakpoint
CREATE TABLE "installment_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"installment_contract_id" uuid NOT NULL,
	"kind" "installment_operation_kind" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_reason" text,
	CONSTRAINT "installment_operations_shop_id_id_key" UNIQUE("shop_id","id"),
	CONSTRAINT "installment_operations_reversed_together" CHECK (num_nonnulls("installment_operations"."reversed_at", "installment_operations"."reversed_by", "installment_operations"."reverse_reason") IN (0, 3) AND btrim(coalesce("installment_operations"."reverse_reason", 'x')) <> ''),
	CONSTRAINT "installment_operations_disbursement_not_reversed" CHECK ("installment_operations"."kind" <> 'disbursement' OR "installment_operations"."reversed_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "installment_contracts" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "installment_operations" ADD CONSTRAINT "installment_operations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_operations" ADD CONSTRAINT "installment_operations_contract_fk" FOREIGN KEY ("shop_id","installment_contract_id") REFERENCES "public"."installment_contracts"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_operations" ADD CONSTRAINT "installment_operations_created_by_fk" FOREIGN KEY ("shop_id","created_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_operations" ADD CONSTRAINT "installment_operations_reversed_by_fk" FOREIGN KEY ("shop_id","reversed_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installment_operations_shop_contract_created_idx" ON "installment_operations" USING btree ("shop_id","installment_contract_id","created_at");--> statement-breakpoint
ALTER TABLE "installment_contracts" ADD CONSTRAINT "installment_contracts_deleted_reason" CHECK (("installment_contracts"."deleted_at" IS NULL) = ("installment_contracts"."deleted_reason" IS NULL) AND btrim(coalesce("installment_contracts"."deleted_reason", 'x')) <> '');