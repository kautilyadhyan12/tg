-- Refunds to review on Overview (ROADMAP Stage 2 item 18d-iv-b-iii; spec Part 3 §14.8). Forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit.
--
-- A fee no longer owed comes off the list when staff keep it: who and when stay on the bill, and the person's page says so. A
-- refund that failed or that Square never answered comes off when staff say no refund is needed: who and when stay on the press.
-- Neither moves money, and a refund can still be sent afterwards from the payment.
ALTER TABLE "gym_member_bills" ADD COLUMN "fee_kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "fee_kept_by" uuid;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_fee_kept_by_fk" FOREIGN KEY ("fee_kept_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_fee_kept_check" CHECK ("fee_kept_at" IS NULL OR "fee" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "no_refund_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "no_refund_by" uuid;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_no_refund_by_fk" FOREIGN KEY ("no_refund_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_no_refund_check" CHECK ("no_refund_at" IS NULL OR "outcome" IN ('failed','lost'));--> statement-breakpoint
-- Overview reads the list each time it opens: only what can be on it, never a gym's whole history.
CREATE INDEX "gym_member_bills_fee_review_idx" ON "gym_member_bills" ("gym_id") WHERE "fee" IS NOT NULL AND "status" = 'paid' AND "fee_kept_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_square_refunds_review_idx" ON "gym_square_refunds" ("gym_id", "started_at") WHERE "no_refund_at" IS NULL AND ("state" = 'pending' OR "outcome" IN ('failed','lost'));
