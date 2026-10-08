-- A limit on personal training sessions on a membership (ROADMAP Stage 2 item 17e-v; spec Part 3 §13.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `pt_limit` a `pt_period` is how many sessions a type that includes personal training
-- allows ("4 a month"); both NULL is no limit, which is what every type has had until now.
-- A pack has none: its own count of sessions is its limit. What is used is never stored:
-- it is counted from `gym_pt_appointments` under the gym's lock when a session is booked.
ALTER TABLE "gym_membership_types" ADD COLUMN "pt_limit" integer;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD COLUMN "pt_period" text;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_pt_limit_check" CHECK (("gym_membership_types"."pt_limit" IS NULL) = ("gym_membership_types"."pt_period" IS NULL) AND ("gym_membership_types"."pt_limit" IS NULL OR ("gym_membership_types"."includes_pt" AND "gym_membership_types"."kind" <> 'pack' AND "gym_membership_types"."pt_limit" BETWEEN 1 AND 200 AND "gym_membership_types"."pt_period" IN ('week','month'))));
