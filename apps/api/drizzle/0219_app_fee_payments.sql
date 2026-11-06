-- Pay a fee in the app (ROADMAP Stage 2 item 18k-ii-b; Kd, 2026-11-06; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member's payment page is for a bill of a membership (`period_index`, 18k-ii-a) or for one of its fees
-- (`fee_bill_id`), never both. The fee has no link, as the membership has none (as `0151` for the Terminal): the payment
-- is recorded on the fee as it stands when Square answers. A fee staff take off while its page is open (marked came, the
-- class or session not running) waits for the page: `removed` asks it closed, and the fee comes off once Square says
-- nothing was paid.
ALTER TABLE "gym_app_payments" ADD COLUMN "fee_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ALTER COLUMN "period_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_payments" DROP CONSTRAINT "gym_app_payments_amount_check";--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999 AND "currency" ~ '^[A-Z]{3}$' AND ("period_index" IS NULL OR "period_index" >= 0) AND "closes_at" > "opened_at");--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_bill_check" CHECK (num_nonnulls("period_index", "fee_bill_id") = 1);--> statement-breakpoint
ALTER TABLE "gym_app_payments" DROP CONSTRAINT "gym_app_payments_close_check";--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_close_check" CHECK (("close_wanted_at" IS NULL) = ("close_wanted_by" IS NULL) AND ("close_wanted_by" IS NULL OR "close_wanted_by" IN ('member','staff','expired','removed')));--> statement-breakpoint
-- The pages that ended needing a check, for the person's page, the card on file, and Pay refusing that bill or fee again.
CREATE INDEX "gym_app_payments_check_idx" ON "gym_app_payments" USING btree ("gym_id","held_membership_id") WHERE "outcome" IN ('not_recorded','gone','no_answer');
