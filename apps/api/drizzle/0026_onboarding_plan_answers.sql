-- ONBOARDING v2 — THE ANSWERS THE PLAN MATHS NEEDS, AND BODY WEIGHT'S ONE
-- SOURCE (ROADMAP Stage 1 item 4a-i; RULINGS 2026-09-07, 2026-09-09 and
-- 2026-09-10). Forward-only. Part 1 is expand-only; part 2 is data-only and
-- idempotent.
--
-- Hand-written, for the recorded reason `0016`-`0025` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- ── PART 1: FIVE NEW COLUMNS, NO NEW TABLE ──────────────────────────────────
-- These are fitness-profile answers and the profile is already 1:1 with the
-- user (RULINGS 2026-07-15), so a second table would only add a join and a
-- second place for one screen (screen 3 writes the target weight AND the pace)
-- to write.
--
-- WHAT IS DELIBERATELY *NOT* ADDED, because the column already exists and one
-- answer must never mean two things:
--   · training days a week  → `exercise_frequency` (0006)
--   · minutes a session     → `session_duration_min` (0006)
--   · equipment             → `available_equipment` (0006)
--   · self-rated level      → `fitness_level` (0006)
--   · age/gender/height/target weight → 0006; body weight → `users.weight_kg`.
-- The v2 surface renames the first two to the words the plan contract and the
-- screens use (`trainingDays`, `sessionMinutes`) and maps them in the repo.
--
-- `main_goal` is the ONE goal of screen 1 (Kd, 2026-09-09 — not a multi-select;
-- two goals that fight cannot both be honoured by one calorie number). The
-- weight direction the maths works in is DERIVED from it in code
-- (`PLAN_GOAL_BY_MAIN_GOAL` in @app/shared), never stored, so the two cannot
-- disagree. The older `fitness_goals` ARRAY from 0006 is kept and still written
-- as a one-element mirror of `main_goal`, because the live macro rings
-- (`/v1/nutrition/targets`) read it; item 4a-ii moves those rings onto these
-- answers and the mirror ends there.
--
-- `push_ups_max` and `plank_hold_seconds` are screen 5's two checks. Both stay
-- NULL when the person skips them ("I'll rate myself") and neither is ever an
-- input to the calorie plan — the plan builder (6a) reads them for the first
-- week's numbers. NULL therefore passes every CHECK below, as it does for every
-- other column on this table: the wizard may save a partial profile.
--
-- PRIVACY: no new table, so nothing changes on the Day-14 delete list or the
-- export list — `user_fitness_profiles` is on both already, the purge deletes
-- the whole row and the export reads the whole row.
ALTER TABLE "user_fitness_profiles"
  ADD COLUMN "main_goal" text,
  ADD COLUMN "pace" text,
  ADD COLUMN "day_activity" text,
  ADD COLUMN "push_ups_max" smallint,
  ADD COLUMN "plank_hold_seconds" smallint;--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_main_goal_check"
    CHECK ("main_goal" IN ('weight_loss', 'muscle_gain', 'general_fitness', 'flexibility', 'endurance', 'posture', 'stress_relief')),
  ADD CONSTRAINT "user_fitness_profiles_pace_check"
    CHECK ("pace" IN ('gentle', 'steady', 'brisk')),
  ADD CONSTRAINT "user_fitness_profiles_day_activity_check"
    CHECK ("day_activity" IN ('sitting', 'on_feet', 'active', 'very_active')),
  ADD CONSTRAINT "user_fitness_profiles_push_ups_max_check"
    CHECK ("push_ups_max" >= 0 AND "push_ups_max" <= 500),
  ADD CONSTRAINT "user_fitness_profiles_plank_hold_seconds_check"
    CHECK ("plank_hold_seconds" >= 0 AND "plank_hold_seconds" <= 3600);--> statement-breakpoint
-- ── PART 2: A TYPED ROW UNDER EVERY WEIGHT THAT HAS NONE ─────────────────────
-- THE RULE THIS SERVES. From this release `users.weight_kg` is only a cache of
-- the newest `body_measurements` row that says something about weight: a row
-- with a `weight_kg`, or a row with source `self_reported` (a weight the
-- person TYPED on a form — which may carry no weight at all, the record of a
-- deliberate clear). Every write to the history recomputes the cache
-- (nutrition/repo.ts refreshWeight), so a deleted mis-entry falls back to the
-- weight before it and never to a blank.
--
-- WHY A BACKFILL. Until now a typed weight was written straight to the column
-- with NO row behind it (the pre-4a-i PATCH /v1/users/me; the users half of the
-- Mongo import), so every such weight would vanish on the person's first
-- ordinary correction — log a weigh-in, delete it, and the cache recomputes
-- from a history that never held their number: a blank plan and blank rings.
-- The two statements make the rule true for every row that already exists, so
-- the live code needs no special case for "a weight with nothing under it".
--
-- STATEMENT 1: a user whose column holds a weight that the newest
-- weight-bearing row does not carry (no such row, or a different number: the
-- column was written directly after it) gets ONE typed row with that number,
-- dated so that it is the newest of everything they have — now(), or one
-- second after their newest entry if that is ahead of the clock. Nobody's
-- number moves; it gains the row that will let it survive.
--
-- STATEMENT 2: a user whose column is EMPTY while their newest
-- weight-bearing row carries a number cleared it on purpose under the old
-- code (the only way that state arises: the import wrote the newest row's
-- number, and only PATCH weightKg: null could empty it after). The clear
-- becomes the row it now is — typed, no weight, newest — so the next edit to
-- their history cannot bring the cleared number back.
--
-- NO status filter, on purpose. A soft-deleted account keeps its weight and
-- its history for the whole undo window (users/repo.ts softDeleteUser nulls
-- neither; only the Day-14 purge in privacy/repo.ts does), and restoreUser
-- brings it back exactly as it was — so it needs the same row as everyone
-- else. A purged account has a NULL column and no rows, so it matches
-- neither statement. Re-running either statement finds nothing to do: after
-- the first run the newest weight-bearing row equals the column for everyone.
INSERT INTO "body_measurements" ("user_id", "measured_at", "weight_kg", "metrics", "source")
SELECT u."id",
       GREATEST(now(), (SELECT max("measured_at") FROM "body_measurements" WHERE "user_id" = u."id") + interval '1 second'),
       u."weight_kg", '{}'::jsonb, 'self_reported'
FROM "users" u
LEFT JOIN LATERAL (
  SELECT "weight_kg" FROM "body_measurements"
  WHERE "user_id" = u."id" AND ("weight_kg" IS NOT NULL OR "source" = 'self_reported')
  ORDER BY "measured_at" DESC, "id" DESC LIMIT 1) newest ON true
WHERE u."weight_kg" IS NOT NULL
  AND (newest."weight_kg" IS NULL OR newest."weight_kg" <> u."weight_kg");--> statement-breakpoint
INSERT INTO "body_measurements" ("user_id", "measured_at", "weight_kg", "metrics", "source")
SELECT u."id",
       GREATEST(now(), (SELECT max("measured_at") FROM "body_measurements" WHERE "user_id" = u."id") + interval '1 second'),
       NULL, '{}'::jsonb, 'self_reported'
FROM "users" u
JOIN LATERAL (
  SELECT "weight_kg" FROM "body_measurements"
  WHERE "user_id" = u."id" AND ("weight_kg" IS NOT NULL OR "source" = 'self_reported')
  ORDER BY "measured_at" DESC, "id" DESC LIMIT 1) newest ON true
WHERE u."weight_kg" IS NULL
  AND newest."weight_kg" IS NOT NULL;
