-- Refund to card at Sell (ROADMAP Stage 2 item 18d-iv-b-ii; spec Part 3 §14.8): a sale paid on the Square Terminal goes back
-- through Square to the card that paid. Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- A press is on a member's payment or on one product of a sale, never both. A basket's products share one Square payment, so
-- at most one press waits on that payment at a time, whichever product it is for. `restock` is how many go back on the shelf:
-- they go when Square takes the refund up, with the row of `gym_sale_refunds` that holds the money, and come off again if
-- Square then says it failed.
ALTER TABLE "gym_square_refunds" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "sale_refund_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "restock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_sale_fk" FOREIGN KEY ("gym_id", "sale_id") REFERENCES "gym_sales"("gym_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_for_check" CHECK (num_nonnulls("payment_id", "sale_id") = 1 AND ("sale_id" IS NOT NULL OR ("restock" = 0 AND "sale_refund_id" IS NULL)) AND ("payment_id" IS NOT NULL OR "member_refund_id" IS NULL));--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_restock_check" CHECK ("restock" BETWEEN 0 AND 99);--> statement-breakpoint
ALTER TABLE "gym_square_refunds" DROP CONSTRAINT "gym_square_refunds_reason_check";--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_reason_check" CHECK ("reason" IN ('paid_twice','charged_too_much','leaving','other','returned','faulty'));--> statement-breakpoint
-- One press waiting on a sale's Square payment at a time, whatever the code in front of it does.
CREATE UNIQUE INDEX "gym_square_refunds_sale_asking_uq" ON "gym_square_refunds" ("gym_id", "square_payment_id") WHERE "state" = 'asking' AND "sale_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_square_refunds_sale_idx" ON "gym_square_refunds" ("gym_id", "sale_id") WHERE "sale_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_square_refunds_sale_refund_idx" ON "gym_square_refunds" ("gym_id", "sale_refund_id") WHERE "sale_refund_id" IS NOT NULL;--> statement-breakpoint
-- A refund to the card reads as the sale's own way, and one Square failed is voided by the app.
ALTER TABLE "gym_sale_refunds" DROP CONSTRAINT "gym_sale_refunds_method_check";--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','terminal'));--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" DROP CONSTRAINT "gym_sale_refunds_void_reason_check";--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_void_reason_check" CHECK ("void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','other','square_failed')));
