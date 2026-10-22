CREATE TYPE "public"."contract_operation_kind" AS ENUM('disbursement', 'pay_interest', 'repay_principal', 'additional_loan', 'extend', 'close');--> statement-breakpoint
CREATE TABLE "contract_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" "contract_operation_kind" NOT NULL,
	"extra_days" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reverse_reason" text,
	CONSTRAINT "contract_operations_shop_id_id_key" UNIQUE("shop_id","id"),
	CONSTRAINT "contract_operations_extra_days" CHECK (("contract_operations"."kind" = 'extend') = ("contract_operations"."extra_days" IS NOT NULL) AND coalesce("contract_operations"."extra_days", 1) > 0),
	CONSTRAINT "contract_operations_reversed_together" CHECK (num_nonnulls("contract_operations"."reversed_at", "contract_operations"."reversed_by", "contract_operations"."reverse_reason") IN (0, 3) AND btrim(coalesce("contract_operations"."reverse_reason", 'x')) <> ''),
	CONSTRAINT "contract_operations_disbursement_not_reversed" CHECK ("contract_operations"."kind" <> 'disbursement' OR "contract_operations"."reversed_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "contract_operations" ADD CONSTRAINT "contract_operations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_operations" ADD CONSTRAINT "contract_operations_contract_fk" FOREIGN KEY ("shop_id","contract_id") REFERENCES "public"."contracts"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_operations" ADD CONSTRAINT "contract_operations_created_by_fk" FOREIGN KEY ("shop_id","created_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_operations" ADD CONSTRAINT "contract_operations_reversed_by_fk" FOREIGN KEY ("shop_id","reversed_by") REFERENCES "public"."users"("shop_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_operations_shop_contract_created_idx" ON "contract_operations" USING btree ("shop_id","contract_id","created_at");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deleted_reason" CHECK (("contracts"."deleted_at" IS NULL) = ("contracts"."deleted_reason" IS NULL) AND btrim(coalesce("contracts"."deleted_reason", 'x')) <> '');--> statement-breakpoint
-- Viết tay: dựng thao tác cho dữ liệu cũ từ sổ két (chỉ có dữ liệu dev, chưa deploy). Gia hạn không thu lãi trước
-- migration này không có dòng sổ két nên không dựng lại được; gia hạn có thu lãi được dựng thành pay_interest.
INSERT INTO "contract_operations" ("id", "shop_id", "contract_id", "kind", "created_by", "created_at")
SELECT t."operation_id", t."shop_id", t."contract_id",
  (CASE
    WHEN bool_or(t."type" = 'disbursement') THEN 'disbursement'
    WHEN bool_or(t."type" = 'additional_loan') THEN 'additional_loan'
    WHEN bool_or(t."type" = 'principal_repayment') THEN
      CASE WHEN c."status" = 'closed' AND bool_or(t."id" = (
        SELECT p."id" FROM "cash_transactions" p
        WHERE p."shop_id" = t."shop_id" AND p."contract_id" = t."contract_id" AND p."type" = 'principal_repayment'
        ORDER BY p."id" DESC LIMIT 1
      )) THEN 'close' ELSE 'repay_principal' END
    ELSE 'pay_interest'
  END)::"contract_operation_kind",
  (array_agg(t."created_by"))[1], min(t."occurred_at")
FROM "cash_transactions" t
JOIN "contracts" c ON c."shop_id" = t."shop_id" AND c."id" = t."contract_id"
WHERE t."type" <> 'reversal'
GROUP BY t."operation_id", t."shop_id", t."contract_id", c."status";
