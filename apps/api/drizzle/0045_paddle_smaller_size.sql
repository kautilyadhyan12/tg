-- A paying gym moves to a smaller size (ROADMAP Stage 3 item 1c-iii). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- subscriptions.pending_plan_id / pending_from
--                        a smaller size the gym chose, due when its paid month ends
--                        (pending_from). The gym keeps its whole size until then; the worker
--                        counts its members shortly before and moves it only if they fit
--                        (Kd, RULINGS 2026-09-25).
-- subscriptions.pending_held_at
--                        when the smaller size's limit started to hold for joins: set as the
--                        switch begins (and at once for a paid trial, which moves at once).
-- subscriptions.pending_warned_at
--                        when the gym's billing staff were emailed that it has too many
--                        members for the size waiting; once per choice.
-- billing_plan_changes.members_counted / requested_plan_id
--                        the members counted when a size waiting was decided, and the size
--                        asked for when a bigger one they fit was made instead (Kd, RULINGS
--                        2026-09-25): the Plan card says which.

ALTER TABLE subscriptions ADD COLUMN pending_plan_id uuid REFERENCES plans(id);--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN pending_from timestamptz;--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN pending_held_at timestamptz;--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN pending_warned_at timestamptz;--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pending_plan_check
  CHECK ((pending_plan_id IS NULL) = (pending_from IS NULL)
     AND (pending_plan_id IS NOT NULL OR (pending_held_at IS NULL AND pending_warned_at IS NULL)));--> statement-breakpoint
CREATE INDEX subscriptions_pending_plan_idx ON subscriptions (pending_from)
  WHERE pending_plan_id IS NOT NULL;--> statement-breakpoint

ALTER TABLE billing_plan_changes ADD COLUMN members_counted integer;--> statement-breakpoint
ALTER TABLE billing_plan_changes ADD COLUMN requested_plan_id uuid REFERENCES plans(id);--> statement-breakpoint
ALTER TABLE billing_plan_changes ADD CONSTRAINT billing_plan_changes_members_counted_check
  CHECK (members_counted IS NULL OR members_counted >= 0);--> statement-breakpoint
CREATE INDEX billing_plan_changes_subscription_idx ON billing_plan_changes (subscription_id, created_at);
