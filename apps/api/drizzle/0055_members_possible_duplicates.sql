-- POSSIBLE DUPLICATES (ROADMAP 5b-iv-a; RULINGS 2026-09-25, 2026-09-30).
--
-- gym_member_list_entries.name_key   the name's words, folded and sorted
--   (`samePerson.ts` `nameKey`), so "Shah, Priya" and "Priya Shah" are one key; '' for a
--   name with no words. Written by the app with the name; NULL on a record written before
--   this migration until `tools/member-name-keys.ts` fills it.
-- gym_member_list_not_duplicates   a pair staff marked Different people, never shown
--   again. Kept with its gym; goes with either record.
ALTER TABLE gym_member_list_entries ADD COLUMN name_key text;--> statement-breakpoint
ALTER TABLE gym_member_list_entries ADD CONSTRAINT gym_member_list_entries_name_key_len_check
  CHECK (name_key IS NULL OR char_length(name_key) <= 400);--> statement-breakpoint
CREATE INDEX gym_member_list_entries_gym_name_key_idx ON gym_member_list_entries (gym_id, name_key)
  WHERE name_key <> '';--> statement-breakpoint
CREATE INDEX gym_member_list_entries_gym_member_number_idx ON gym_member_list_entries (gym_id, lower(member_number))
  WHERE member_number IS NOT NULL;--> statement-breakpoint
CREATE TABLE gym_member_list_not_duplicates (
  gym_id uuid NOT NULL,
  first_entry_id uuid NOT NULL,
  second_entry_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_member_list_not_duplicates_pk PRIMARY KEY (gym_id, first_entry_id, second_entry_id),
  CONSTRAINT gym_member_list_not_duplicates_order_check CHECK (first_entry_id < second_entry_id),
  CONSTRAINT gym_member_list_not_duplicates_first_fk FOREIGN KEY (gym_id, first_entry_id)
    REFERENCES gym_member_list_entries (gym_id, id) ON DELETE CASCADE,
  CONSTRAINT gym_member_list_not_duplicates_second_fk FOREIGN KEY (gym_id, second_entry_id)
    REFERENCES gym_member_list_entries (gym_id, id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX gym_member_list_not_duplicates_second_idx ON gym_member_list_not_duplicates (gym_id, second_entry_id);
