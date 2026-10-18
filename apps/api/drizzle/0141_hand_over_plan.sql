-- A gym paying through Paddle handed to a co-owner (ROADMAP Stage 2 item 4b-iii-a;
-- rulings/2026-10-18-4b-iii-a.md). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- Accept hands the gym over at once and the old owner's plan stops renewing: it stays paid to
-- the end of its month, and the new owner chooses their own plan, in their own name, when it
-- ends (Kd, 2026-10-18: one card window a Paddle plan, shared with the old owner's own Paddle
-- page, cannot safely take the new owner's card). The plan row says it was handed over, by
-- whom, and when Paddle was told to end it; the worker tells Paddle again until it has.
ALTER TABLE "subscriptions" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "handed_over_from" uuid REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
-- When Paddle confirmed the plan ends with its month; null while it still has to be told.
ALTER TABLE "subscriptions" ADD COLUMN "handed_over_end_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_handed_over_check" CHECK (
  "handed_over_at" IS NOT NULL OR ("handed_over_from" IS NULL AND "handed_over_end_sent_at" IS NULL)
);--> statement-breakpoint
-- The worker's every minute: handed-over plans still live.
CREATE INDEX IF NOT EXISTS "subscriptions_handed_over_idx" ON "subscriptions" USING btree ("handed_over_at")
  WHERE "handed_over_at" IS NOT NULL AND "status" IN ('trialing','active','past_due');
