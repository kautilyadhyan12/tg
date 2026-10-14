-- Each person's weekly challenges (ROADMAP 35b).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row per person per week, the week's Monday in their own time zone: the challenges
-- picked when the person first read that week's, kept so they stay the same until Sunday.
-- How far along each is, and the XP it gives, is worked out on every read from the
-- person's own workouts and meals, never stored here.
CREATE TABLE "weekly_challenges" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "week_start" date NOT NULL,
  "codes" text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "weekly_challenges_pkey" PRIMARY KEY ("user_id", "week_start"),
  CONSTRAINT "weekly_challenges_monday_check" CHECK (extract(isodow FROM "week_start") = 1),
  CONSTRAINT "weekly_challenges_codes_check" CHECK (cardinality("codes") BETWEEN 1 AND 3)
);
