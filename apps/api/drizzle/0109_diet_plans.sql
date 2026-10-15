-- A person's own diet plan (ROADMAP 34e-i; RULINGS 2026-09-12).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row per person: the week, Monday to Sunday, that repeats until they change it.
-- `days` holds seven lists of meals, each with its foods priced as a logged meal's are.
-- `recent_changes` holds the phone's ids of the last changes, so a change sent twice is
-- made once.
CREATE TABLE "diet_plans" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "days" jsonb NOT NULL,
  "recent_changes" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "diet_plans_days_check" CHECK (jsonb_typeof("days") = 'array' AND jsonb_array_length("days") = 7)
);
