-- A gym paying through Paddle handed to a co-owner (ROADMAP Stage 2 item 4b-iii-a;
-- rulings/2026-10-18-4b-iii-a.md). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- Accept opens Paddle's card window for the person asked: Paddle's own window for the
-- plan's card, pointed at that person's Paddle customer. The gym moves when it saves their
-- card, then Paddle's payer is moved to them. A window that is no longer wanted is pointed back
-- at the plan's own payer, which makes Paddle refuse it (measured on Kd's sandbox,
-- 2026-10-18). The five refs are written together, the first time Accept opens the window.
ALTER TABLE "gym_owner_requests" ADD COLUMN "card_subscription_ref" text;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD COLUMN "card_txn_ref" text;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD COLUMN "card_customer_ref" text;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD COLUMN "card_address_ref" text;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD COLUMN "card_opened_at" timestamp with time zone;--> statement-breakpoint
-- Pointed back at the plan's own payer (or found saved), so nothing is left to do with it.
ALTER TABLE "gym_owner_requests" ADD COLUMN "card_closed_at" timestamp with time zone;--> statement-breakpoint
-- After the hand-over: Paddle's payer is the new owner.
ALTER TABLE "gym_owner_requests" ADD COLUMN "payer_moved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD CONSTRAINT "gym_owner_requests_card_check" CHECK (
  ("card_txn_ref" IS NULL AND "card_subscription_ref" IS NULL AND "card_customer_ref" IS NULL
    AND "card_address_ref" IS NULL AND "card_opened_at" IS NULL AND "card_closed_at" IS NULL AND "payer_moved_at" IS NULL)
  OR ("card_txn_ref" IS NOT NULL AND "card_subscription_ref" IS NOT NULL AND "card_customer_ref" IS NOT NULL
    AND "card_address_ref" IS NOT NULL AND "card_opened_at" IS NOT NULL)
);--> statement-breakpoint
-- The worker's every minute: windows still open, and payers still to move.
CREATE INDEX IF NOT EXISTS "gym_owner_requests_card_work_idx" ON "gym_owner_requests" USING btree ("card_opened_at")
  WHERE "card_txn_ref" IS NOT NULL AND ("card_closed_at" IS NULL OR ("state" = 'accepted' AND "payer_moved_at" IS NULL));
