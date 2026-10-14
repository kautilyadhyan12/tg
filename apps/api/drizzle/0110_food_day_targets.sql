-- Each day's food targets, kept for "Your week in food" (ROADMAP 34f-i).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row per person per day of their own time zone: the targets the rings showed when
-- the person last logged a meal that day, or last changed their numbers. A day with no
-- row is read against today's targets.
CREATE TABLE "food_day_targets" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "kcal" integer NOT NULL,
  "protein_g" integer NOT NULL,
  "carbs_g" integer NOT NULL,
  "fat_g" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "food_day_targets_pkey" PRIMARY KEY ("user_id", "day"),
  CONSTRAINT "food_day_targets_kcal_check" CHECK ("kcal" BETWEEN 0 AND 20000),
  CONSTRAINT "food_day_targets_macros_check" CHECK ("protein_g" BETWEEN 0 AND 2000 AND "carbs_g" BETWEEN 0 AND 2000 AND "fat_g" BETWEEN 0 AND 2000)
);
