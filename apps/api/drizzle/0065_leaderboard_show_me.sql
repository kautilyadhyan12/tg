-- The leaderboard's "Show me" for an under-18, and the index its boards read (ROADMAP
-- Stage 2 item 19a-i; spec Part 3 §15.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- An under-18 is hidden from every gym's board until they choose Show me. `leaderboard_opt_out`
-- false cannot say that on its own: it is also every account's untouched default.
ALTER TABLE "users" ADD COLUMN "leaderboard_shown_at" timestamp with time zone;--> statement-breakpoint
-- The boards and "On a roll" read a gym's counted visits, all of them for all time and the
-- Streak. This index holds everything those reads need, so they never touch the table
-- (measured on 66,275 visits: the read 75 ms to 17 ms).
CREATE INDEX "gym_attendance_counted_idx" ON "gym_attendance" ("gym_id", "day") INCLUDE ("user_id", "entry_id") WHERE "method" IN ('pass','key_tag','staff');
