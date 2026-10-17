-- A basket at Sell (ROADMAP Stage 2 item 18q; Kd, `rulings/2026-10-16-18p.md`): several products
-- in one sale, one payment and one receipt. Forward-only. Hand-written, as `0016` onwards are;
-- its journal entry is part of this commit.
--
-- A sale stays one `gym_sales` row per product: its line. The lines of one sale share its
-- receipt number, its request key, who bought it, how it was paid and its day, and are numbered
-- from 1 in the order they were rung up. Each line keeps its own discount and its own refunds,
-- as one product's sale did. Every sale made before this is a sale of one line, numbered 1.
ALTER TABLE "gym_sales" ADD COLUMN "line_no" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_line_no_check" CHECK ("line_no" BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "gym_sales" DROP CONSTRAINT "gym_sales_receipt_uq";--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_receipt_uq" UNIQUE ("gym_id", "receipt_number", "line_no");--> statement-breakpoint
ALTER TABLE "gym_sales" DROP CONSTRAINT "gym_sales_request_uq";--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_request_uq" UNIQUE ("gym_id", "request_key", "line_no");--> statement-breakpoint
-- One product is one line of a sale: more of it is a bigger quantity, never a second line.
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_basket_product_uq" UNIQUE ("gym_id", "receipt_number", "product_id");
