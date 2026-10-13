-- Who can check in (ROADMAP Stage 2 item 16d; spec Part 3 §12.4).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's own two choices for its front desk: whom it checks in, and what it does with
-- somebody whose payment is overdue. Every gym starts where it was: everyone, let in.
ALTER TABLE "gyms" ADD COLUMN "checkin_who" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "checkin_overdue" text DEFAULT 'let_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_checkin_rules_check" CHECK ("checkin_who" IN ('everyone', 'current_membership') AND "checkin_overdue" IN ('let_in', 'see_staff'));
