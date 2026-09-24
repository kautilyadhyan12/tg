-- A paying gym's failed payment and its 2-day grace (ROADMAP Stage 3 item 1c-i; Part 5
-- §8). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of
-- this commit.
--
-- subscriptions.past_due_since  when this row last became past_due; null otherwise. The
--                               worker ends the grace 2 days after it.
--
-- A row whose grace ended carries cancel_reason 'grace_expired' until Paddle collects
-- the payment or ends the subscription; while it does, the gym's fix is its card on
-- Paddle's page, never a second Subscribe.

ALTER TABLE subscriptions ADD COLUMN past_due_since timestamptz;--> statement-breakpoint
-- Only a past_due row has it. No row is past_due before this job, so every row passes.
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_past_due_since_check
  CHECK (past_due_since IS NULL OR status IN ('past_due','expired'));--> statement-breakpoint
CREATE INDEX subscriptions_grace_idx ON subscriptions (past_due_since) WHERE status = 'past_due';
