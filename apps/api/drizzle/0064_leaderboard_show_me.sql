-- The leaderboard's "Show me" for an under-18 (ROADMAP Stage 2 item 19a-i; spec Part 3 §15.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- An under-18 is hidden from every gym's board until they choose Show me. `leaderboard_opt_out`
-- false cannot say that on its own: it is also every account's untouched default.
ALTER TABLE "users" ADD COLUMN "leaderboard_shown_at" timestamp with time zone;
