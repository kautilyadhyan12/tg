-- BODY WEIGHT HAS ONE SOURCE, AND NO COPY (RULINGS 2026-09-10). Forward-only.
--
-- WHY. `0026` made the weigh-in history the source of body weight and kept
-- `users.weight_kg` as a cache of its newest weight-bearing row. A cache is a
-- second copy of one fact, and every write to the history had to remember to
-- recompute it. This migration removes the copy. From here the number every
-- screen shows is read from the history each time (nutrition/repo.ts
-- currentWeightKg), so there is nothing to keep in step.
--
-- Hand-written, for the recorded reason `0016`-`0026` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`. Its journal entry is part of this commit.
--
-- ── PART 1: NOTHING IS LOST — 0026'S BACKFILL, ONCE MORE ─────────────────────
-- The two statements are 0026's, unchanged and idempotent: a weight that only
-- lives in the column gets a typed row carrying it, dated newest; an emptied
-- column over a weighed row becomes a typed clear. After 0026 the live code
-- kept the two equal, but the Mongo import tool still wrote the column
-- directly, so they run again here, immediately before the column goes. On a
-- database where they have nothing to do (every database 0026 ran on and the
-- import never touched) they insert nothing.
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
  AND newest."weight_kg" IS NOT NULL;--> statement-breakpoint
-- ── PART 2: THE COPY GOES ────────────────────────────────────────────────────
ALTER TABLE "users" DROP COLUMN "weight_kg";--> statement-breakpoint
-- ── PART 3: `source` IS A STATUS COLUMN NOW, SO IT GETS ITS CHECK ─────────────
-- It decides what counts as "typed by me" (and, with no weight, as a clear).
-- The two values are the only ones any writer has ever used: the default
-- 'manual' (weigh-ins, the Mongo import) and 'self_reported' (typed).
ALTER TABLE "body_measurements"
  ADD CONSTRAINT "body_measurements_source_check"
    CHECK ("source" IN ('manual', 'self_reported'));--> statement-breakpoint
-- ── PART 4: AN AGE THE APP NO LONGER ACCEPTS IS UNANSWERED ───────────────────
-- The app is for 16 and over (RULINGS 2026-09-07); the old profile form took
-- 13. A stored 13-15 made both onboarding routes fail for that person
-- (`planAnswersFor` re-parses the stored answers through the plan's rails).
-- Cleared, not raised: the person is asked again, and an unanswered field is
-- the honest state (RULINGS 2026-07-15). Dev accounts only — production
-- starts empty (RULINGS 2026-07-13).
UPDATE "user_fitness_profiles" SET "age" = NULL WHERE "age" < 16;
