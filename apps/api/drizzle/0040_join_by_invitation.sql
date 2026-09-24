-- Joining a gym by invitation (Part 3 §10.2, §13.2; ROADMAP Stage 2 item 3b-ii-a).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- gym_members.entry_id        the list record the invitation was for, written when the
--                             person taps Join (§13.2): what bookings, visits and "who
--                             may book" read later. Held with the gym in the key, so a
--                             membership can only ever point at its own gym's record; a
--                             record deleted for good clears it, nothing else.
-- gym_invites.answered_at     when the invitation was accepted, declined or withdrawn.
-- gym_invites.waiting_since   a Join refused because the gym had no free place; staff read
--                             "invited · waiting for a place". Only on a waiting one.
-- gym_invites_email_hmac_idx  what is waiting for a signed-in address, across every gym.

ALTER TABLE gym_member_list_entries ADD CONSTRAINT gym_member_list_entries_gym_id_uq UNIQUE (gym_id, id);--> statement-breakpoint
ALTER TABLE gym_members ADD COLUMN entry_id uuid;--> statement-breakpoint
ALTER TABLE gym_members ADD CONSTRAINT gym_members_entry_fk
  FOREIGN KEY (gym_id, entry_id) REFERENCES gym_member_list_entries (gym_id, id)
  ON DELETE SET NULL (entry_id);--> statement-breakpoint
CREATE INDEX gym_members_entry_idx ON gym_members (entry_id) WHERE entry_id IS NOT NULL;--> statement-breakpoint

ALTER TABLE gym_invites ADD COLUMN answered_at timestamptz;--> statement-breakpoint
ALTER TABLE gym_invites ADD COLUMN waiting_since timestamptz;--> statement-breakpoint
-- 3b-i only ever wrote 'pending', so every row already satisfies both.
ALTER TABLE gym_invites ADD CONSTRAINT gym_invites_answered_check
  CHECK ((state = 'pending') = (answered_at IS NULL));--> statement-breakpoint
ALTER TABLE gym_invites ADD CONSTRAINT gym_invites_waiting_check
  CHECK (waiting_since IS NULL OR state = 'pending');--> statement-breakpoint
CREATE INDEX gym_invites_email_hmac_idx ON gym_invites (email_hmac);
