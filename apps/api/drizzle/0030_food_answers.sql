-- SCREEN 9'S TWO ANSWERS (ROADMAP Stage 1 item 4b-ii; RULINGS 2026-09-10 and
-- 2026-09-12). Forward-only, two columns and their CHECKs.
--
-- Hand-written, for the recorded reason `0016`-`0029` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- WHAT CHANGES. The food screen asks two things and stores them here: the diet
-- (vegetarian · vegetarian with eggs · non-vegetarian · vegan, RULINGS
-- 2026-09-10) and how many meals a day. NO cuisine column: Kd ruled cuisine out
-- entirely on 2026-09-12, at sign-up and in the suggestions.
--
-- NO BACKFILL, AND NO DEFAULT. Nobody has ever been asked either question, so
-- every existing row is honestly unanswered — and a guessed diet is the one
-- default that would put meat in front of a vegetarian. Both stay NULL until
-- the person answers (RULINGS 2026-07-15: unanswered is not a default), which
-- is why neither column is NOT NULL: the wizard is partial by design, and
-- Settings asks the same two questions afterwards.
--
-- The value sets are CHECKed here as well as in the contract, as every other
-- answer on this table is since 0028: the database refuses what the contract
-- refuses, for any writer that skips it. NULL passes both CHECKs (IN and
-- BETWEEN yield NULL, not false) — deliberate, as above.
--
-- Meals a day is `smallint`, like screen 5's two checks: a whole number
-- between 2 and 6 (`mealsPerDaySchema`). Two is a real answer — a skipped
-- meal on purpose — and six is as many sittings as a day is ever planned in.
ALTER TABLE "user_fitness_profiles" ADD COLUMN "diet" text;--> statement-breakpoint
ALTER TABLE "user_fitness_profiles" ADD COLUMN "meals_per_day" smallint;--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_diet_check"
    CHECK ("diet" IN ('vegetarian', 'vegetarian_eggs', 'non_vegetarian', 'vegan'));--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_meals_per_day_check"
    CHECK ("meals_per_day" BETWEEN 2 AND 6);
