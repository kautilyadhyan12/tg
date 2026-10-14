-- Each person's weekly challenges (ROADMAP 35b).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row per person per week, the week's Monday in their own time zone: the challenges
-- picked when the person first read that week's, kept so they stay the same until Sunday.
-- How far along each is, and the XP it gives, is worked out on every read from the
-- person's own workouts and meals, never stored here.
--
-- `time_zone` is the zone the week was picked in: its days are always read in that zone,
-- so changing zone later never moves a workout into another week. `held_codes` are the
-- week's challenges that Safe mode paused: once paused, they pay nothing for that week.
CREATE TABLE "weekly_challenges" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "week_start" date NOT NULL,
  "time_zone" text NOT NULL,
  "codes" text[] NOT NULL,
  "held_codes" text[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "weekly_challenges_pkey" PRIMARY KEY ("user_id", "week_start"),
  CONSTRAINT "weekly_challenges_monday_check" CHECK (extract(isodow FROM "week_start") = 1),
  CONSTRAINT "weekly_challenges_codes_check" CHECK (cardinality("codes") BETWEEN 1 AND 3),
  CONSTRAINT "weekly_challenges_held_codes_check" CHECK ("held_codes" <@ "codes")
);
