-- Viết tay: unaccent là extension "trusted" (PG 13+), chủ DB tạo được. unaccent() chỉ STABLE nên bọc trong hàm IMMUTABLE
-- (gọi kèm từ điển, schema cố định) để dùng được trong index; tìm kiếm phải gọi đúng search_text() mới khớp index.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE FUNCTION search_text(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN lower(public.unaccent('public.unaccent'::regdictionary, $1));--> statement-breakpoint
-- Hạn đóng lãi kỳ tiếp theo, như nextInterestDue (pawn/domain/contract.ts): thu lãi trước đóng đầu kỳ, thu lãi sau đóng cuối kỳ.
CREATE FUNCTION contract_interest_due(paid_until date, prepaid boolean, period_days integer) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN paid_until + CASE WHEN prepaid THEN 0 ELSE period_days END;--> statement-breakpoint
DROP INDEX "customers_full_name_trgm_idx";--> statement-breakpoint
CREATE INDEX "contracts_shop_customer_idx" ON "contracts" USING btree ("shop_id","customer_id");--> statement-breakpoint
CREATE INDEX "customers_full_name_search_trgm_idx" ON "customers" USING gin (search_text("full_name") gin_trgm_ops);