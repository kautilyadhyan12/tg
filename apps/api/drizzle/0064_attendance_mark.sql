-- Staff check people in from the console (ROADMAP Stage 2 item 16b-ii; spec Part 3 §12.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- An eleventh privilege, `attendance.mark`: owner and manager by default, and the owner can
-- tick it for a trainer. The list below is `ORG_PRIVILEGES` in `@app/shared`, and
-- `db.migration.test.ts` reads the deployed predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark']::text[]);--> statement-breakpoint

-- Every owner and manager row holding its own ticks gets it, as `0035` did for
-- `schedule.manage`: nobody has decided anything about a tick that did not exist. A
-- trainer's row, and a NULL set (which reads the role's defaults), are left alone.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'attendance.mark')
WHERE "privileges" IS NOT NULL
  AND "role" IN ('owner','manager')
  AND NOT ("privileges" @> ARRAY['attendance.mark']::text[]);
