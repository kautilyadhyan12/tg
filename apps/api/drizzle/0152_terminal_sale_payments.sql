-- Take payment on Terminal at Sell (ROADMAP Stage 2 item 18d-vi-b-ii; spec Part 3 §14.8).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A press pays a period of a membership, one of its fees, or a basket at Sell (`sale`): the
-- basket as it was priced when the card was asked for, recorded as that sale when Square says
-- the money was taken (`sale_receipt_number`). A sale has no membership. Who bought it is the
-- row's own `entry_id`, never inside `sale`, so a record deleted for good lets go of it here too.
-- A sale paid on the Terminal names Square's payment, as a payment on a bill does.
ALTER TABLE "gym_terminal_payments" ALTER COLUMN "held_membership_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD COLUMN "sale" jsonb;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD COLUMN "sale_receipt_number" integer;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" DROP CONSTRAINT "gym_terminal_payments_bill_check";--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_bill_check" CHECK (num_nonnulls("period_index", "fee_bill_id", "sale") = 1 AND ("held_membership_id" IS NULL) = ("sale" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" DROP CONSTRAINT "gym_terminal_payments_paid_check";--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_paid_check" CHECK ((("outcome" IS NOT DISTINCT FROM 'paid') = ("member_payment_id" IS NOT NULL OR "sale_receipt_number" IS NOT NULL)) AND ("member_payment_id" IS NULL OR "sale_receipt_number" IS NULL) AND ("outcome" NOT IN ('paid','not_recorded') OR "square_payment_id" IS NOT NULL));--> statement-breakpoint
-- Sell reads the gym's sales waiting on a Terminal.
CREATE INDEX "gym_terminal_payments_sale_idx" ON "gym_terminal_payments" USING btree ("gym_id") WHERE "state" = 'waiting' AND "sale" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD COLUMN "square_payment_id" text;--> statement-breakpoint
ALTER TABLE "gym_sales" DROP CONSTRAINT "gym_sales_method_check";--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_method_check" CHECK ("method" IN ('cash','card_at_desk','bank_transfer','terminal'));--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_square_payment_check" CHECK (("method" = 'terminal') = ("square_payment_id" IS NOT NULL) AND ("square_payment_id" IS NULL OR "square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$'));
