-- Take payment on Terminal on a late cancel or no-show fee (ROADMAP Stage 2 item 18d-vi-b-i;
-- spec Part 3 §14.8). Forward-only. Hand-written, as `0016` onwards are; its journal entry is
-- part of this commit. Renumbered from 0150 when 18t's `0150_joining_fee` merged first.
--
-- A press is for a period of a membership (`period_index`, 18d-vi-a) or for one of its fees
-- (`fee_bill_id`), never both. The fee has no link, as the membership has none: the payment is
-- recorded on the fee as it stands when Square answers, and a fee taken off by then leaves the
-- row to say so.
ALTER TABLE "gym_terminal_payments" ADD COLUMN "fee_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ALTER COLUMN "period_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" DROP CONSTRAINT "gym_terminal_payments_amount_check";--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999 AND "currency" ~ '^[A-Z]{3}$' AND ("period_index" IS NULL OR "period_index" >= 0));--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_bill_check" CHECK (("fee_bill_id" IS NULL) = ("period_index" IS NOT NULL));
