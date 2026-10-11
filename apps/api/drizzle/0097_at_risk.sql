-- At risk (ROADMAP Stage 2 item 20d-i; spec Part 3 §16.4).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's own two numbers for the At risk list: no visit for so many days, and how many
-- of the four weeks before that the person came in. Every gym starts on 14 and 2.
ALTER TABLE "gyms" ADD COLUMN "at_risk_quiet_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "at_risk_weeks_came" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_at_risk_check" CHECK ("at_risk_quiet_days" IN (7, 10, 14, 21, 30) AND "at_risk_weeks_came" BETWEEN 1 AND 4);
