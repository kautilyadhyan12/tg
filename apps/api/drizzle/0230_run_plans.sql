-- The run plan's answers (ROADMAP Stage 5 item 37d-i). Forward-only. Hand-written, as `0016` onwards
-- are; its journal entry is part of this commit.
--
-- One row per person once they have answered the running questions on the Running page: the answers,
-- read through `runPlanAnswersSchema` on the way in and out, and when they were given (the plan's
-- week 1 is the week of that day in the person's own time zone). The plan itself is never kept: it is
-- worked out from these and the runs recorded each time it is read. A person's own data: exported
-- and deleted with them, never read by a gym.
CREATE TABLE "run_plans" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "answers" jsonb NOT NULL,
  "answered_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "run_plans_answers_check" CHECK (jsonb_typeof("answers") = 'object')
);
