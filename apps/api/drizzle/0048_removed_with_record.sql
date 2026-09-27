-- ONE REMOVE, PUT BACK AND NOT THIS PERSON (spec Part 3 §18; RULINGS 2026-09-27, 2026-09-28).
--
-- gym_members.removed_entry_id   the list record staff removed this member WITH: set when
--   removing a member ends their app because the list says, for certain, that this record
--   is theirs (One Remove from either door, Remove all). Put back on that record gives
--   their app back, and only a removal written here reads "Removed from app" on a record.
--   Null for a removal the list cannot pin to one person (a family sharing one email, a
--   person who is on no list, Not this person), and for removals made before this.
--
-- gym_invites.wrong_person_at   staff said the person using this address is not the
--   person on the list ("Not {name}?"): the invitation stays stopped, nothing is sent to
--   the address again, and the record reads "Someone else uses …" until its email changes.
ALTER TABLE gym_members ADD COLUMN removed_entry_id uuid;--> statement-breakpoint
ALTER TABLE gym_members ADD CONSTRAINT gym_members_removed_entry_fk
  FOREIGN KEY (gym_id, removed_entry_id) REFERENCES gym_member_list_entries (gym_id, id)
  ON DELETE SET NULL (removed_entry_id);--> statement-breakpoint
ALTER TABLE gym_members ADD CONSTRAINT gym_members_removed_entry_check
  CHECK (removed_entry_id IS NULL OR removed_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX gym_members_removed_entry_idx ON gym_members (removed_entry_id) WHERE removed_entry_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE gym_invites ADD COLUMN wrong_person_at timestamptz;--> statement-breakpoint
ALTER TABLE gym_invites ADD CONSTRAINT gym_invites_wrong_person_check
  CHECK (wrong_person_at IS NULL OR state = 'withdrawn');
