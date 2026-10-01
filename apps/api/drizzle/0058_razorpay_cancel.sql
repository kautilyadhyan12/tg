-- A gym paying through Razorpay cancels its plan from the console (ROADMAP Stage 3 item 1d-ii).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- subscriptions.cancel_sent_at   when our server told the provider to end the plan. Razorpay
--                                cannot take a cancel back (tried on the test account,
--                                2026-10-01), so a cancel is kept here first and sent in the
--                                hours before the paid month ends; until then the gym can keep
--                                its plan. Only ever set on a plan set to end.
-- billing_refunds.reason         gains 'cancelled': a payment taken for a month after the plan
--                                was set to end, refunded in full.

ALTER TABLE subscriptions ADD COLUMN cancel_sent_at timestamptz;--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_cancel_sent_check
  CHECK (cancel_sent_at IS NULL OR cancel_at_period_end);--> statement-breakpoint
CREATE INDEX subscriptions_cancel_due_idx ON subscriptions (current_period_end)
  WHERE cancel_at_period_end AND provider = 'razorpay' AND status IN ('trialing','active','past_due');--> statement-breakpoint
ALTER TABLE billing_refunds DROP CONSTRAINT billing_refunds_reason_check;--> statement-breakpoint
ALTER TABLE billing_refunds ADD CONSTRAINT billing_refunds_reason_check
  CHECK (reason IN ('duplicate','unmatched','cancelled'));
