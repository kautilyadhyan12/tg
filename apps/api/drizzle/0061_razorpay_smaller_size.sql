-- A gym paying through Razorpay moves to a smaller size (ROADMAP Stage 3 item 1d-iii-b).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Razorpay charges only a plan the gym approved in its window (a ₹5 check, given back, tried on
-- the test account 2026-10-01), so a smaller size is a NEW Razorpay subscription approved when
-- it is chosen, starting the day the paid month ends. It waits on the gym's plan like Paddle's
-- (`pending_plan_id`, `pending_from`). Shortly before that day the members are counted: if they
-- fit, it takes the place of the plan; if not, it is cancelled and the gym stays on its size
-- (Kd, RULINGS 2026-10-01).
--
-- subscriptions.pending_subscription_ref   the approved Razorpay subscription of the smaller
--                                          size waiting; null for Paddle and when none waits.
-- billing_checkouts.size_direction         'bigger' or 'smaller' for a checkout that replaces a
--                                          plan; null for a first plan (Subscribe).
-- billing_checkouts.state 'approved'       a smaller size's window approved: it waits on the plan.
-- billing_checkouts.state 'dropped'        an approved smaller size no longer waiting (cancelled,
--                                          too many members, another chosen), ended at Razorpay.
-- billing_plan_changes.provider 'razorpay' a smaller size not made for too many members, which
--                                          the Plan card and the email say.

ALTER TABLE subscriptions ADD COLUMN pending_subscription_ref text;--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pending_ref_check
  CHECK (pending_subscription_ref IS NULL OR (pending_plan_id IS NOT NULL AND provider = 'razorpay'));--> statement-breakpoint
CREATE UNIQUE INDEX subscriptions_pending_ref_uq ON subscriptions (pending_subscription_ref)
  WHERE pending_subscription_ref IS NOT NULL;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD COLUMN size_direction text;--> statement-breakpoint
UPDATE billing_checkouts SET size_direction = 'bigger' WHERE replaces_subscription_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD CONSTRAINT billing_checkouts_size_direction_check
  CHECK ((size_direction IS NULL) = (replaces_subscription_id IS NULL)
         AND (size_direction IS NULL OR size_direction IN ('bigger','smaller'))
         AND (upfront_minor IS NULL OR size_direction = 'bigger'));--> statement-breakpoint
ALTER TABLE billing_checkouts DROP CONSTRAINT billing_checkouts_state_check;--> statement-breakpoint
ALTER TABLE billing_checkouts ADD CONSTRAINT billing_checkouts_state_check
  CHECK (state IN ('creating','open','superseded','failed','paid','approved','dropped')
         AND (state NOT IN ('approved','dropped') OR size_direction = 'smaller'));--> statement-breakpoint
CREATE INDEX billing_checkouts_approved_idx ON billing_checkouts (gym_id) WHERE state = 'approved';--> statement-breakpoint
ALTER TABLE billing_plan_changes DROP CONSTRAINT billing_plan_changes_provider_check;--> statement-breakpoint
ALTER TABLE billing_plan_changes ADD CONSTRAINT billing_plan_changes_provider_check
  CHECK (provider IN ('paddle','razorpay'));
