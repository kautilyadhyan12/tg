-- "Not me" (Part 3 §10.2; ROADMAP Stage 2 item 3b-ii-b; RULINGS 2026-09-23, gap A).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- gym_invites.not_me_at  the person the invitation reached said it is not theirs: the
--                        gym has the wrong address for somebody. Only on a declined
--                        invitation; any later answer, a withdrawal or Send again
--                        clears it.

ALTER TABLE gym_invites ADD COLUMN not_me_at timestamptz;--> statement-breakpoint
-- No row has it yet, so every row satisfies the check.
ALTER TABLE gym_invites ADD CONSTRAINT gym_invites_not_me_check
  CHECK (not_me_at IS NULL OR state = 'declined');--> statement-breakpoint
CREATE INDEX gym_invites_not_me_idx ON gym_invites (gym_id) WHERE not_me_at IS NOT NULL;
