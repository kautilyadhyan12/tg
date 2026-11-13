-- Your own maximum heart rate (ROADMAP Stage 5 item 37f-ii-a). Forward-only. Hand-written, as `0016`
-- onwards are. Its journal entry is part of this commit.
--
-- One row per person who typed their own maximum heart rate, which the five heart rate zones are worked
-- from instead of 220 less their age. A table of its own, so starting setup again (which deletes the
-- person's `user_fitness_profiles` row) never takes it. A person's own data: exported and deleted with
-- them, never read by a gym.
CREATE TABLE "user_heart_max" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "bpm" smallint NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_heart_max_bpm_check" CHECK ("bpm" BETWEEN 100 AND 230)
);
