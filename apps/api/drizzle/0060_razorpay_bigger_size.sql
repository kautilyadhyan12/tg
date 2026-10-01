-- A gym paying through Razorpay moves to a bigger size (ROADMAP Stage 3 item 1d-iii-a).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Razorpay cannot change the amount of a plan paid by an Indian card, UPI or bank account
-- ("Can't update subscription immediately when card mandate is applicable", tried on the test
-- account, 2026-10-01). A bigger size is a NEW Razorpay subscription the gym approves in its
-- window: the rest of this month's difference taken now (an add-on), the new price from the
-- day the paid month ends. When it is paid, it takes the place of the plan it replaces.
--
-- billing_checkouts.replaces_subscription_id  the gym's plan this checkout replaces; null for a
--                                             first plan (Subscribe).
-- billing_checkouts.period_start              when that paid month began: with starts_at, the month
--                                             a second bigger size in it is priced against.
-- billing_checkouts.starts_at                 the replaced plan's paid month's end, when the new
--                                             price is first charged.
-- billing_checkouts.upfront_minor             the rest of this month's difference, taken as the
--                                             window is paid; null when it is under ₹1.
-- subscriptions.cancel_reason 'replaced'      a plan a bigger size took the place of; its
--                                             cancel_sent_at is set once Razorpay has ended it.

ALTER TABLE billing_checkouts ADD COLUMN replaces_subscription_id uuid REFERENCES subscriptions(id);--> statement-breakpoint
ALTER TABLE billing_checkouts ADD COLUMN period_start timestamptz;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD COLUMN starts_at timestamptz;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD COLUMN upfront_minor integer;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD CONSTRAINT billing_checkouts_replaces_check
  CHECK ((replaces_subscription_id IS NULL) = (starts_at IS NULL)
         AND (replaces_subscription_id IS NULL) = (period_start IS NULL)
         AND (replaces_subscription_id IS NULL OR provider = 'razorpay')
         AND (upfront_minor IS NULL OR (replaces_subscription_id IS NOT NULL AND upfront_minor >= 100)));--> statement-breakpoint
CREATE INDEX subscriptions_replaced_uncancelled_idx ON subscriptions (ended_at)
  WHERE cancel_reason = 'replaced' AND cancel_sent_at IS NULL;
