-- A paying gym moves to a smaller size (ROADMAP Stage 3 item 1c-iii). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- subscriptions.pending_plan_id / pending_from
--                        a smaller size the gym chose: new members join only up to its limit
--                        from the moment it is chosen, and Paddle bills it from pending_from,
--                        the end of the month already paid (Kd, RULINGS 2026-09-25). The
--                        worker switches the price at Paddle shortly before then. Both null
--                        on every other row.

ALTER TABLE subscriptions ADD COLUMN pending_plan_id uuid REFERENCES plans(id);--> statement-breakpoint
ALTER TABLE subscriptions ADD COLUMN pending_from timestamptz;--> statement-breakpoint
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pending_plan_check
  CHECK ((pending_plan_id IS NULL) = (pending_from IS NULL));--> statement-breakpoint
CREATE INDEX subscriptions_pending_plan_idx ON subscriptions (pending_from)
  WHERE pending_plan_id IS NOT NULL;
