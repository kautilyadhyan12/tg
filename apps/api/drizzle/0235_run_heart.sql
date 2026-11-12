-- Heart rate from a strap or a watch (ROADMAP Stage 5 item 37f-i). Forward-only. Hand-written, as `0016`
-- onwards are; renumbered from 0233, then 0234, because 18l-ii-a's 0233 and 18l-ii-b's 0234 merged first (CLAUDE.md §8). Its journal entry
-- is part of this commit.
--
-- A run's average and highest heart rate, beats a minute over its time running, worked out on the server
-- from the readings the phone sends (`heartSums`); the readings themselves are not kept. Null for a run
-- with none. The person's own, as the rest of the run is: exported and deleted with them, never read by a
-- gym.
ALTER TABLE "runs" ADD COLUMN "heart_avg" smallint;
ALTER TABLE "runs" ADD COLUMN "heart_max" smallint;
ALTER TABLE "runs" ADD CONSTRAINT "runs_heart_check" CHECK (("heart_avg" IS NULL AND "heart_max" IS NULL) OR ("heart_avg" BETWEEN 30 AND 240 AND "heart_max" BETWEEN 30 AND 240 AND "heart_avg" <= "heart_max"));
