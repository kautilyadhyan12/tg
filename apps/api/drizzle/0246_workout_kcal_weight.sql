-- The body weight a workout's calories were worked out at (ROADMAP Stage 5 job 64a-iii, round one H1).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The summary after a workout says "About 39 kcal for you, at 82 kg". The calories are worked out when the
-- workout is saved, at the person's weight then; read later, today's weight beside them would be false. So the
-- save keeps the weight it used, in grams. Empty where the person had given none (70 kg was used), and on every
-- older workout.
ALTER TABLE "workouts" ADD COLUMN "kcal_weight_grams" integer;
--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_kcal_weight_check" CHECK ("workouts"."kcal_weight_grams" IS NULL OR "workouts"."kcal_weight_grams" BETWEEN 1 AND 999990);
