-- What a workout keeps (spec Part 2 §13.5; ROADMAP Stage 5 job 61a). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- New columns on the same two tables, so every old reader (goals, XP, the boards, the gym's numbers)
-- keeps reading them unchanged. Every new column is empty on an old row.
ALTER TABLE "workouts" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "started_from" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "effort" smallint;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "heart_avg" smallint;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "heart_max" smallint;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_name_check" CHECK ("workouts"."name" IS NULL OR char_length("workouts"."name") BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_started_from_check" CHECK ("workouts"."started_from" IN ('saved','app_plan','gym_plan','none'));--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_effort_check" CHECK ("workouts"."effort" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_heart_check" CHECK (("workouts"."heart_avg" IS NULL AND "workouts"."heart_max" IS NULL) OR ("workouts"."heart_avg" BETWEEN 30 AND 240 AND "workouts"."heart_max" BETWEEN 30 AND 240 AND "workouts"."heart_avg" <= "workouts"."heart_max"));--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "counted" text;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "measured_in" text;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "target" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "weight_grams" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "rest_seconds" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_counted_check" CHECK ("workout_sets"."counted" IN ('camera','hand','timer'));--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_measured_in_check" CHECK ("workout_sets"."measured_in" IN ('reps','time'));--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_target_check" CHECK ("workout_sets"."target" > 0);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_weight_grams_check" CHECK ("workout_sets"."weight_grams" BETWEEN 1 AND 1000000);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_rest_seconds_check" CHECK ("workout_sets"."rest_seconds" BETWEEN 0 AND 3600);
