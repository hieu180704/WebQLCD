DROP INDEX "contracts_asset_name_trgm_idx";--> statement-breakpoint
CREATE INDEX "contracts_asset_name_search_trgm_idx" ON "contracts" USING gin (search_text("asset_name") gin_trgm_ops);