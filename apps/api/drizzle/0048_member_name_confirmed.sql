-- "This is them" (spec Part 3 §18.4; Kd, 2026-09-27): staff say that somebody who signed
-- up in the app under another name ("Dan Wu") is the person on this record ("Daniel Wu"),
-- and the list stops asking. Kept with the membership, for that one record: matched to a
-- different record later, the question comes back.
ALTER TABLE gym_members
  ADD COLUMN name_confirmed_entry_id uuid,
  ADD CONSTRAINT gym_members_name_confirmed_fk FOREIGN KEY (gym_id, name_confirmed_entry_id)
    REFERENCES gym_member_list_entries (gym_id, id) ON DELETE SET NULL (name_confirmed_entry_id);
