-- A refund on the Square Terminal (ROADMAP Stage 2 item 18d-iv-c; spec Part 3 §14.8). Forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit.
--
-- Square refunds an Interac debit card only with the card present, so such a press waits on a Terminal for the person. It stays
-- `asking` while it waits, so nothing else moves on that bill or sale, and the Terminal takes nothing else. `cancelled`: it stopped
-- there and no money went. `interac`: Square's simulated Terminal that takes an Interac payment, in its test area only.
ALTER TABLE "gym_square_refunds" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "terminal_refund_id" text;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "picked_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "cancel_wanted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "cancel_too_late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" DROP CONSTRAINT "gym_square_refunds_outcome_check";--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_outcome_check" CHECK (("state" = 'done') = ("outcome" IS NOT NULL) AND ("outcome" IS NULL OR "outcome" IN ('completed','failed','refused','lost','cancelled')));--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_terminal_check" CHECK (("device_id" IS NOT NULL OR ("terminal_refund_id" IS NULL AND "outcome" IS DISTINCT FROM 'cancelled')) AND ("terminal_refund_id" IS NULL OR "terminal_refund_id" ~ '^[A-Za-z0-9:_-]{1,255}$'));--> statement-breakpoint
CREATE INDEX "gym_square_refunds_terminal_idx" ON "gym_square_refunds" ("environment", "account_id", "device_id") WHERE "state" = 'asking' AND "device_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_terminals" DROP CONSTRAINT "gym_square_terminals_practice_check";--> statement-breakpoint
ALTER TABLE "gym_square_terminals" ADD CONSTRAINT "gym_square_terminals_practice_check" CHECK ("practice" IS NULL OR ("practice" IN ('saves','declines','cancels','times_out','offline','interac') AND "environment" = 'sandbox' AND "state" = 'paired' AND "device_code_id" IS NULL));
