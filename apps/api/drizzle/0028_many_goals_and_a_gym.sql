-- MANY GOALS, AND A GYM (ROADMAP Stage 1 item 4a-iv; RULINGS 2026-09-10 and
-- 2026-09-11). Forward-only. Part 1 adds the weight choice, part 2 moves every
-- existing answer onto it, part 3 drops the old column, part 4 is equipment.
--
-- Hand-written, for the recorded reason `0016`-`0027` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- WHAT CHANGES. Screen 1 asked ONE main goal out of seven (`main_goal`, 0026),
-- and the direction the calories follow was DERIVED from it. From here it asks
-- two things (RULINGS 2026-09-10): ONE weight choice — lose weight · keep my
-- weight · gain weight — which alone sets the calories and is STORED as the
-- direction the plan maths works in (`weight_goal`), and "also work on", any
-- number of goals, none of which moves the calories (`fitness_goals`, the list
-- 0006 already owns). Weight loss leaves that list, because it is a weight
-- choice; two goals join it, get stronger (`strength`) and better balance
-- (`balance`). Building muscle stays on it: it is not gaining weight (RULINGS
-- 2026-09-11). Settings asks the same two questions and writes the same two
-- columns, so there is nothing left to keep in step.
--
-- ── PART 1: THE WEIGHT CHOICE ────────────────────────────────────────────────
ALTER TABLE "user_fitness_profiles" ADD COLUMN "weight_goal" text;--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_weight_goal_check"
    CHECK ("weight_goal" IN ('lose', 'maintain', 'gain'));--> statement-breakpoint
-- ── PART 2: EVERYONE MOVES OVER WITH THE CALORIES THEY SEE TODAY ─────────────
-- Weight loss → lose, with the target and pace it already has. The five goals
-- that held the weight → maintain: their plan already ate what they burn.
-- Build muscle → NO weight choice (RULINGS 2026-09-11). Its old direction,
-- gain, is the mix-up Kd ruled out, and the science leaves keep or gain to the
-- person (muscle grows without a surplus, and a small one mostly helps a lean,
-- trained lifter), so they are asked. The calorie rings name the one question,
-- and the target and pace they gave stay stored, so "gain weight" brings back
-- the plan they had. No main goal (the old five-step form never asked one)
-- stays no weight choice: the rings already ask it today.
UPDATE "user_fitness_profiles"
SET "weight_goal" = CASE "main_goal" WHEN 'weight_loss' THEN 'lose' WHEN 'muscle_gain' THEN NULL ELSE 'maintain' END
WHERE "main_goal" IS NOT NULL;--> statement-breakpoint
-- The old main goal joins "also work on" unless it was weight loss, which
-- leaves every list; the rest keep the order they were ticked in, and a goal
-- already on the list is not added twice. Build muscle's people therefore find
-- it ticked beside the one question they are asked.
UPDATE "user_fitness_profiles"
SET "fitness_goals" = ARRAY(
  SELECT g FROM (
    SELECT "main_goal" AS g, 0::bigint AS i
    WHERE "main_goal" IS NOT NULL AND "main_goal" <> 'weight_loss'
      AND NOT ("main_goal" = ANY (coalesce("fitness_goals", '{}')))
    UNION ALL
    SELECT kept.g, kept.i FROM unnest(coalesce("fitness_goals", '{}')) WITH ORDINALITY AS kept(g, i)
    WHERE kept.g <> 'weight_loss'
  ) goals
  ORDER BY i)
WHERE "main_goal" IS NOT NULL OR 'weight_loss' = ANY ("fitness_goals");--> statement-breakpoint
-- ── PART 3: THE OLD COLUMN GOES, AND THE LIST GETS ITS CHECK ─────────────────
-- Dropping `main_goal` drops its CHECK with it. The list's values were held by
-- the contract alone; with the value set now ruled, the database refuses a
-- value the contract would refuse, for any writer that skips it, as it does
-- for every other answer on this table.
ALTER TABLE "user_fitness_profiles" DROP COLUMN "main_goal";--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_fitness_goals_check"
    CHECK ("fitness_goals" <@ ARRAY['muscle_gain', 'strength', 'general_fitness', 'endurance', 'flexibility', 'posture', 'balance', 'stress_relief']::text[]);--> statement-breakpoint
-- ── PART 4: "A GYM", AND "NO EQUIPMENT" STANDS ALONE ─────────────────────────
-- "A gym (everything there)" joins the home equipment (RULINGS 2026-09-10,
-- decision B). "No equipment" beside anything else is not an answer to "what
-- do you have to train with?", and both screens now make it exclusive as you
-- tap. The old form could store the pair, so the real equipment wins, as
-- screen 7 already loads it; then the CHECK holds the rule for every writer.
UPDATE "user_fitness_profiles"
SET "available_equipment" = array_remove("available_equipment", 'none')
WHERE 'none' = ANY ("available_equipment") AND cardinality("available_equipment") > 1;--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_available_equipment_check"
    CHECK ("available_equipment" <@ ARRAY['none', 'dumbbells', 'resistance_bands', 'kettlebells', 'pull_up_bar', 'gym']::text[]
           AND NOT ('none' = ANY ("available_equipment") AND cardinality("available_equipment") > 1));
