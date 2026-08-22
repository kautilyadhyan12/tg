ALTER TABLE "gym_staff" ADD COLUMN "privileges" text[];--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage']::text[]);--> statement-breakpoint
-- The rows that predate the column get the set their ROLE already gave them, so
-- nobody's access changes by one tick on the day this lands. Written here, in
-- the migration, rather than as the separate batched job R4.4 asks for: the
-- whole table is 2 rows on the dev database and 0 on a fresh one (measured
-- 2026-08-22, both owners), so there is no lock to spread out, while a backfill
-- somebody has to remember to run separately is how staff rows end up NULL and
-- reading their defaults for ever. Idempotent by its own WHERE.
--
-- These three sets are ROLE_PRIVILEGES in `modules/orgs/service.ts` at the
-- moment this migration was written, sorted the way the write path sorts them.
-- They are a SNAPSHOT and are deliberately not kept in step with that constant:
-- a later edit there must not reach back and change what these two people can
-- do, which is exactly what Kd ruled on 2026-08-22.
UPDATE "gym_staff" SET "privileges" = CASE "role"
  WHEN 'owner'   THEN ARRAY['codes.invite','codes.manage','members.confirm','members.read','members.remove','staff.manage']::text[]
  WHEN 'manager' THEN ARRAY['codes.invite','codes.manage','members.confirm','members.read','members.remove']::text[]
  WHEN 'trainer' THEN ARRAY['codes.invite','members.read']::text[]
END
WHERE "privileges" IS NULL;
