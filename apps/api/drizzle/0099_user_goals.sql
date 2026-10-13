-- A person's goals (ROADMAP Stage 5 item 30a; RULINGS 2026-09-07, "Goals and plans").
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row per goal. The id is the phone's own, so a request sent twice is one goal.
-- `target` is null where the target is read from the person's plan (weight, calories,
-- protein); the rules that depend on age and the health answer are worked out on every
-- read and are not CHECKs here, because those answers change under a stored row.
CREATE TABLE "user_goals" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "period" text,
  "target" integer,
  "exercise_id" uuid REFERENCES "exercises"("id"),
  "set_by" text DEFAULT 'user' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_goals_kind_check" CHECK ("kind" IN ('training_days','streak','gym_visits','calories_burned','active_minutes','reps_in_set','weight','calories_within','protein','food_logged_days')),
  CONSTRAINT "user_goals_period_check" CHECK ("period" IN ('day','week','month','year')),
  CONSTRAINT "user_goals_set_by_check" CHECK ("set_by" IN ('app','user')),
  CONSTRAINT "user_goals_target_check" CHECK ("target" > 0)
);--> statement-breakpoint
-- One goal of each kind, period and exercise for a person; it also serves the read by person.
CREATE UNIQUE INDEX "user_goals_one_of_each_uq" ON "user_goals" ("user_id", "kind", coalesce("period", ''), coalesce("exercise_id", '00000000-0000-0000-0000-000000000000'::uuid));
