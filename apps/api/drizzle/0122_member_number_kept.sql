-- The app numbers members itself (ROADMAP Stage 2 item 5e-i; Kd, 2026-10-15).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The highest member number of the gym's sequence, kept when a number goes (a record
-- deleted for good, a number changed or merged away), so the next number given is never
-- one somebody had. NULL until a number is given or goes.
ALTER TABLE "gym_member_lists" ADD COLUMN "member_number_kept" text;--> statement-breakpoint
ALTER TABLE "gym_member_lists" ADD CONSTRAINT "gym_member_lists_member_number_kept_check" CHECK ("member_number_kept" IS NULL OR length("member_number_kept") <= 64);
