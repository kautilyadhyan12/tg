-- The app's starter goals are given once (ROADMAP Stage 5 item 30b). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The mark is on the account, not the setup answers: "Reset onboarding" deletes those,
-- and a starter goal the person removed must not come back when setup is done again.
ALTER TABLE "users" ADD COLUMN "starter_goals_at" timestamp with time zone;
