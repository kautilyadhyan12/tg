-- POSSIBLE DUPLICATES, KEPT (ROADMAP 5b-iv; the feature's security pass, H1).
--
-- gym_member_list_pairs   the gym's possible-duplicate pairs, worked out once and read a page
--   at a time, so a page costs the same at two hundred records as at twenty thousand: the
--   first MEMBER_LIST_DUPLICATES_KEPT (1,000) by name. Rows the app works out, not facts: no
--   keys to the records (a record deleted or changed changes the stamp, and a page shows a
--   pair only while both records are the gym's).
-- gym_member_lists.pairs_stamp   what the records and the Different people marks held when
--   the pairs were worked out (`repo.pairsStamp`); a read whose stamp differs works them out
--   again. NULL until the first read.
-- gym_member_lists.pairs_count   how many pairs there are, for the Members sign.
-- gym_member_lists.pairs_kept   how many of them gym_member_list_pairs holds.
-- gym_member_lists.pairs_built_at, pairs_cost_ms   when they were last worked out, and how
--   long it took: work that took long is done at most once a minute.
CREATE TABLE gym_member_list_pairs (
  gym_id uuid NOT NULL,
  first_entry_id uuid NOT NULL,
  second_entry_id uuid NOT NULL,
  first_name text NOT NULL,
  same_name boolean NOT NULL,
  same_phone boolean NOT NULL,
  same_number boolean NOT NULL,
  CONSTRAINT gym_member_list_pairs_pk PRIMARY KEY (gym_id, first_name, first_entry_id, second_entry_id),
  CONSTRAINT gym_member_list_pairs_gym_id_gyms_id_fk FOREIGN KEY (gym_id) REFERENCES gyms (id) ON DELETE CASCADE
);--> statement-breakpoint
ALTER TABLE gym_member_lists ADD COLUMN pairs_stamp text;--> statement-breakpoint
ALTER TABLE gym_member_lists ADD COLUMN pairs_count integer;--> statement-breakpoint
ALTER TABLE gym_member_lists ADD COLUMN pairs_kept integer;--> statement-breakpoint
ALTER TABLE gym_member_lists ADD COLUMN pairs_built_at timestamptz;--> statement-breakpoint
ALTER TABLE gym_member_lists ADD COLUMN pairs_cost_ms integer;--> statement-breakpoint
ALTER TABLE gym_member_lists ADD CONSTRAINT gym_member_lists_pairs_count_check
  CHECK (pairs_count IS NULL OR (pairs_count >= 0 AND pairs_kept BETWEEN 0 AND pairs_count));
