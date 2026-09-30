-- REVIEW NEEDED (ROADMAP 5b-v-d-iv; RULINGS 2026-09-29).
--
-- gym_member_list_entries.needs_review   what an import found wrong on this record, one
--   item per problem and field ("phone_unusual:phone", "cell_cut:extra:notes"); names
--   only, never the file's cell. Set when an import is confirmed; an item goes when staff
--   edit that field, press It's correct, or a later file brings a good value.
-- gym_member_list_entries.review_checked   the items staff pressed It's correct on: the
--   next file with the same value does not mark it again. An item goes once the field's
--   value changes.
ALTER TABLE gym_member_list_entries ADD COLUMN needs_review text[] NOT NULL DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE gym_member_list_entries ADD COLUMN review_checked text[] NOT NULL DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE gym_member_list_entries ADD CONSTRAINT gym_member_list_entries_review_size_check
  CHECK (cardinality(needs_review) <= 104 AND cardinality(review_checked) <= 104);--> statement-breakpoint
CREATE INDEX gym_member_list_entries_needs_review_idx ON gym_member_list_entries (gym_id, listed_seq)
  WHERE former_at IS NULL AND needs_review <> '{}'::text[];
