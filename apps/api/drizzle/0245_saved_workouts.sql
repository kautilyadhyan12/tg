-- A person's saved workouts (spec Part 2 §13.5; ROADMAP Stage 5 job 61c). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- Made fresh, in the one shape of a planned workout: a name and, in order, exercises with their sets.
-- The old `workout_templates` is left as it is; no route reads it. A saved workout's sets carry no
-- user_id of their own: they are owned through their saved workout and go with it by the cascade, as
-- `workout_sets` go with their workout. A deleted saved workout's id stays with its owner, as
-- `meal_removed_ids` does a meal's, so a late save of it keeps nothing.
CREATE TABLE "saved_workouts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "edited_at" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "saved_workouts_name_check" CHECK (char_length("name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE INDEX "saved_workouts_user_edited_idx" ON "saved_workouts" ("user_id", "edited_at" DESC);
--> statement-breakpoint
CREATE TABLE "saved_workout_sets" (
  "saved_workout_id" uuid NOT NULL REFERENCES "saved_workouts"("id") ON DELETE CASCADE,
  "exercise_place" smallint NOT NULL,
  "set_place" smallint NOT NULL,
  "exercise_id" uuid NOT NULL REFERENCES "exercises"("id"),
  "measured_in" text NOT NULL,
  "target" integer NOT NULL,
  "weight_grams" integer,
  "rest_seconds" integer,
  CONSTRAINT "saved_workout_sets_pkey" PRIMARY KEY ("saved_workout_id", "exercise_place", "set_place"),
  CONSTRAINT "saved_workout_sets_places_check" CHECK ("exercise_place" BETWEEN 0 AND 49 AND "set_place" BETWEEN 0 AND 199),
  CONSTRAINT "saved_workout_sets_measured_in_check" CHECK ("measured_in" IN ('reps','time')),
  CONSTRAINT "saved_workout_sets_target_check" CHECK ("target" BETWEEN 1 AND 14400),
  CONSTRAINT "saved_workout_sets_weight_grams_check" CHECK ("weight_grams" BETWEEN 1 AND 1000000),
  CONSTRAINT "saved_workout_sets_rest_seconds_check" CHECK ("rest_seconds" BETWEEN 0 AND 3600)
);
--> statement-breakpoint
CREATE INDEX "saved_workout_sets_exercise_idx" ON "saved_workout_sets" ("exercise_id");
--> statement-breakpoint
CREATE TABLE "saved_workout_removed_ids" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "removed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "saved_workout_removed_ids_user_idx" ON "saved_workout_removed_ids" ("user_id");
