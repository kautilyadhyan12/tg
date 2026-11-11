-- Your own run plan (ROADMAP Stage 5 item 37d-iii-b). Forward-only. Hand-written, as `0016` onwards
-- are; its journal entry is part of this commit.
--
-- One row per person once they pick Suggested or My plan, or write their own week: the pick (null until
-- they pick: My plan where they have one, else Suggested), and their own week, Monday to Sunday, a run or
-- null for a rest day, read through `ownWeekSchema` on the way in and out. A person's own data: exported
-- and deleted with them, never read by a gym.
CREATE TABLE "own_run_plans" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "choice" text,
  "days" jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "own_run_plans_choice_check" CHECK ("choice" IN ('suggested', 'mine')),
  CONSTRAINT "own_run_plans_days_check" CHECK (jsonb_typeof("days") = 'array')
);
