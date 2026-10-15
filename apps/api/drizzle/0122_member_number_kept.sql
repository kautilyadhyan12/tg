-- The app numbers members itself (ROADMAP Stage 2 item 5e-i; Kd, 2026-10-15).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The highest member number of EACH of the gym's sequences that has had a number given or
-- gone (a record deleted for good, a number changed or merged away), keyed by the
-- sequence's prefix folded to lower case ("" for plain numbers), so the next number given
-- is never one somebody had, whichever sequence the gym uses later.
ALTER TABLE "gym_member_lists" ADD COLUMN "member_numbers_kept" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_lists" ADD CONSTRAINT "gym_member_lists_member_numbers_kept_check" CHECK (jsonb_typeof("member_numbers_kept") = 'object');
