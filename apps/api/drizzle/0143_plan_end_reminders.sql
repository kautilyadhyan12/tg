-- A plan set to end is reminded (ROADMAP Stage 2 item 4b-iv; rulings/2026-10-20-4b-iii-b.md).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A plan cancelled or handed over emails the gym's owner and billing staff 7 days and 1 day
-- before it ends. Each column holds the end date its reminder was sent for: a plan kept and
-- set to end again for a later month is reminded again, and never twice for the same end.
ALTER TABLE "subscriptions" ADD COLUMN "end_week_reminded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "end_day_reminded_for" timestamp with time zone;--> statement-breakpoint
-- The billing worker's every minute: live plans set to end.
CREATE INDEX IF NOT EXISTS "subscriptions_set_to_end_idx" ON "subscriptions" USING btree ("current_period_end")
  WHERE "cancel_at_period_end" AND "status" IN ('trialing','active');
