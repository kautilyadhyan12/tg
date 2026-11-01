-- A refund made inside Square shown on a sale (ROADMAP Stage 2 item 18d-iv-d-ii; spec Part 3 §14.8). Forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit.
--
-- `to_place`: Square refunded part of a basket and names no product, so no row of `gym_sale_refunds` holds the money until staff say which.
-- `in_square` on `gym_sale_refunds`: a refund noted by card that the app crossed out, as Square's own record of that money replaced it.
-- `look_at` on a sale's press left "We don't know": Square's own record is now read to answer it too.
ALTER TABLE "gym_square_refunds" ADD COLUMN "to_place" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_to_place_check" CHECK (NOT "to_place" OR ("sale_id" IS NOT NULL AND "from_square" AND "parts" IS NULL));--> statement-breakpoint
CREATE INDEX "gym_square_refunds_to_place_idx" ON "gym_square_refunds" ("gym_id", "sale_id") WHERE "to_place";--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" DROP CONSTRAINT "gym_sale_refunds_void_reason_check";--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_void_reason_check" CHECK ("void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','other','square_failed','in_square')));--> statement-breakpoint
UPDATE "gym_square_refunds" SET "look_at" = now() WHERE "outcome" = 'lost' AND "sale_id" IS NOT NULL AND "no_refund_at" IS NULL;
