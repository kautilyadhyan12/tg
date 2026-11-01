-- The food search reads our own copy of the packaged-food lists (ROADMAP Stage 5 33b-iii-d). Empty on a
-- server not yet loaded; a list loaded before this has no search words until it is imported again
-- (RUNBOOK/load-packaged-food-lists.md). Forward-only. Hand-written, as `0016` onwards are.
-- The second, smaller index is what makes a common word quick: "chocolate" sorts 6,398 scanned products
-- rather than 90,715 (measured 2026-11-01).
ALTER TABLE "off_products" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "off_products" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "search_text")) STORED;
--> statement-breakpoint
ALTER TABLE "off_products" ADD COLUMN "scans" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "off_products" ADD CONSTRAINT "off_products_scans_check" CHECK ("scans" >= 0);
--> statement-breakpoint
ALTER TABLE "usda_branded_products" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "usda_branded_products" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "search_text")) STORED;
--> statement-breakpoint
CREATE INDEX "off_products_search_idx" ON "off_products" USING gin ("search");
--> statement-breakpoint
CREATE INDEX "off_products_popular_search_idx" ON "off_products" USING gin ("search") WHERE "scans" >= 3;
--> statement-breakpoint
CREATE INDEX "usda_branded_products_search_idx" ON "usda_branded_products" USING gin ("search");
