-- The day a desk signature's record was deleted for good (ROADMAP Stage 2 item 3e-iii;
-- spec Part 3 §10.10). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- A desk signature outlives its record as the gym's proof, and the purge removes it six
-- years after that day (Kd, rulings/2026-10-14-3e-ii.md). The code that deletes a record
-- writes the day in the same statement that lets go of it (memberList/repo.ts). A deletion
-- that skips that statement would leave a signature with no day, kept for ever, so it is
-- refused instead: the record's link no longer lets go by itself (checked when the
-- transaction commits, so a gym deleted outright still takes its signatures with its
-- waivers), and the CHECK refuses a signature with neither a record nor a day.
ALTER TABLE "gym_waiver_desk_signatures" ADD COLUMN "record_deleted_at" timestamp with time zone;--> statement-breakpoint
-- A signature whose record is already gone has no day kept: its six years start now.
UPDATE "gym_waiver_desk_signatures" SET "record_deleted_at" = now() WHERE "entry_id" IS NULL;--> statement-breakpoint
ALTER TABLE "gym_waiver_desk_signatures" ADD CONSTRAINT "gym_waiver_desk_signatures_deleted_day_check" CHECK ("entry_id" IS NOT NULL OR "record_deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "gym_waiver_desk_signatures" DROP CONSTRAINT "gym_waiver_desk_signatures_entry_fk";--> statement-breakpoint
ALTER TABLE "gym_waiver_desk_signatures" ADD CONSTRAINT "gym_waiver_desk_signatures_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries"("gym_id", "id") DEFERRABLE INITIALLY DEFERRED;
