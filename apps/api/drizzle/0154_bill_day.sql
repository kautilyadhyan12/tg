-- Bill everyone on one day of the month (ROADMAP Stage 2 item 18y; Kd, `rulings/2026-10-22-18y.md`).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's day of the month: every new monthly or yearly membership is billed on it, its first
-- bill the part month up to it. Null, as every gym is today, bills each from the day it starts.
-- 28 at most, so every month has it.
ALTER TABLE "gyms" ADD COLUMN "bills_day" integer;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_bills_day_check" CHECK ("bills_day" BETWEEN 1 AND 28);--> statement-breakpoint
-- A membership given while the gym had a day: the first of those days after its start, from which
-- its full periods count; its first period runs from the start to the day before. Never more than
-- a month after the start, and only on a repeating membership counted in months or years.
ALTER TABLE "gym_held_memberships" ADD COLUMN "full_from" date;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_full_from_check" CHECK (
  "full_from" IS NULL
  OR ("kind" = 'recurring' AND "term_unit" IN ('month','year') AND "full_from" > "starts_on" AND "full_from" <= "starts_on" + 31)
);
