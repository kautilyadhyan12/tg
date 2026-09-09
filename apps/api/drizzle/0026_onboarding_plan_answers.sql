-- ONBOARDING v2 — THE ANSWERS THE PLAN MATHS NEEDS (ROADMAP Stage 1 item 4a,
-- server half; RULINGS 2026-09-07 and 2026-09-09). Expand-only, forward-only.
--
-- Hand-written, for the recorded reason `0016`-`0025` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- FIVE NEW COLUMNS, NO NEW TABLE. These are fitness-profile answers and the
-- profile is already 1:1 with the user (RULINGS 2026-07-15), so a second table
-- would only add a join and a second place for one screen (screen 3 writes the
-- target weight AND the pace) to write.
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
    CHECK ("plank_hold_seconds" >= 0 AND "plank_hold_seconds" <= 3600);
