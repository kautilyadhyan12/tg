-- The Reports page's permission (ROADMAP Stage 2 item 21a-i; spec Part 3 §16.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A fifteenth privilege, `reports.read`: owner and manager by default, and the owner can
-- tick it for a trainer. The list below is `ORG_PRIVILEGES` in `@app/shared`, and
-- `db.migration.test.ts` reads the deployed predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark','leaderboard.manage','memberships.manage','posts.manage','reports.read']::text[]);--> statement-breakpoint

-- Every owner and manager row holding its own ticks gets it, as `0071` did for
-- `posts.manage`. A trainer's row, a NULL set (which reads the role's defaults), and a
-- person on one of the gym's own roles (whose ticks the owner chose) are left alone.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'reports.read')
WHERE "privileges" IS NOT NULL
  AND "role" IN ('owner','manager')
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['reports.read']::text[]);--> statement-breakpoint

-- A manager's invitation still waiting gets it too. A gym's own saved roles, and an
-- invitation to one of them, are left alone: their ticks are the owner's own choice.
UPDATE "gym_staff_invites"
SET "privileges" = array_append("privileges", 'reports.read')
WHERE "state" = 'pending'
  AND "role" = 'manager'
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['reports.read']::text[]);
