-- The day a desk signature's record was deleted for good (ROADMAP Stage 2 item 3e-iii;
-- spec Part 3 §10.10). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- A desk signature outlives its record as the gym's proof, and the purge removes it six
-- years after that day (Kd, rulings/2026-10-14-3e-ii.md). The code that deletes a record
-- writes the day in the same statement that lets go of it (memberList/repo.ts).
ALTER TABLE "gym_waiver_desk_signatures" ADD COLUMN "record_deleted_at" timestamp with time zone;--> statement-breakpoint
-- A signature whose record is already gone has no day kept: its six years start now.
UPDATE "gym_waiver_desk_signatures" SET "record_deleted_at" = now() WHERE "entry_id" IS NULL;
