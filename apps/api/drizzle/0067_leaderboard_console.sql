-- The leaderboard in the console (ROADMAP Stage 2 item 19a-iii; spec Part 3 §15.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The boards a gym has switched off for its members. Empty: members see all three.
ALTER TABLE "gyms" ADD COLUMN "leaderboard_boards_off" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_leaderboard_boards_off_check" CHECK ("gyms"."leaderboard_boards_off" <@ ARRAY['gym_days','workout_days','streak']::text[]);--> statement-breakpoint

-- A twelfth privilege, `leaderboard.manage`: owner and manager by default, and the owner can
-- tick it for a trainer. The list below is `ORG_PRIVILEGES` in `@app/shared`, and
-- `db.migration.test.ts` reads the deployed predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark','leaderboard.manage']::text[]);--> statement-breakpoint

-- Every owner and manager row holding its own ticks gets it, as `0064` did for
-- `attendance.mark`. A trainer's row, a NULL set (which reads the role's defaults), and a
-- person on one of the gym's own roles (whose ticks the owner chose) are left alone.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'leaderboard.manage')
WHERE "privileges" IS NOT NULL
  AND "role" IN ('owner','manager')
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['leaderboard.manage']::text[]);--> statement-breakpoint

-- A manager's invitation still waiting gets it too. A gym's own saved roles
-- (`gym_staff_roles`), and an invitation to one of them, are left alone: their ticks are
-- the owner's own choice.
UPDATE "gym_staff_invites"
SET "privileges" = array_append("privileges", 'leaderboard.manage')
WHERE "state" = 'pending'
  AND "role" = 'manager'
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['leaderboard.manage']::text[]);
