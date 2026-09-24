-- A paying gym moves to a bigger size (ROADMAP Stage 3 item 1c-ii). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- subscriptions.trial_seat_cap
--                        a trial the gym has paid for keeps its free trial's member limit
--                        until Paddle takes the first payment; the plan's own limit starts
--                        then (Kd, RULINGS 2026-09-25). Null on every other row.
-- billing_plan_changes   every size change a gym's billing staff asked for: which plan to
--                        which, who pressed it, and how it ended. One may be under way per
--                        gym at a time, so two presses cannot both ask Paddle to charge;
--                        the same Idempotency-Key answers from its row.

ALTER TABLE subscriptions ADD COLUMN trial_seat_cap integer;--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_trial_seat_cap_check
  CHECK (trial_seat_cap IS NULL OR trial_seat_cap > 0);--> statement-breakpoint

CREATE TABLE billing_plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  from_plan_id uuid NOT NULL REFERENCES plans(id),
  to_plan_id uuid NOT NULL REFERENCES plans(id),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  provider text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  failure text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_plan_changes_provider_check CHECK (provider IN ('paddle')),
  CONSTRAINT billing_plan_changes_state_check CHECK (state IN ('pending','done','failed')),
  CONSTRAINT billing_plan_changes_failure_check CHECK ((state = 'failed') = (failure IS NOT NULL)),
  CONSTRAINT billing_plan_changes_key_check CHECK (length(idempotency_key) BETWEEN 1 AND 100),
  CONSTRAINT billing_plan_changes_gym_key_uq UNIQUE (gym_id, idempotency_key)
);--> statement-breakpoint
CREATE UNIQUE INDEX billing_plan_changes_one_pending_uq ON billing_plan_changes (gym_id)
  WHERE state = 'pending';
