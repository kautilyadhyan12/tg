-- A cooling-off period on a line of the price list (ROADMAP Stage 2 item 18v-iii; Kd, 2026-11-04,
-- `rulings/2026-11-04-18v-iii.md`). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- A line with a price may hold a cooling-off period in days (`cooling_off_days`). A membership given
-- from it copies it, as it copies the minimum term; one given by Change membership or taken from the
-- gym's own list has none. `cooling_off_added` is the gym's day it was given, kept with the days: they
-- count from it, or from its start where earlier, or from its agreement's signing where that falls inside
-- them (the rule, `heldMemberships.ts`). Staff cancelling it inside them with a full refund set `changed_mind`:
-- it is cancelled that day, and what was paid for it is listed to be refunded until it has been.
ALTER TABLE "gym_membership_types" ADD COLUMN "cooling_off_days" integer;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_cooling_off_check" CHECK ("cooling_off_days" IS NULL OR ("price_minor" > 0 AND "cooling_off_days" BETWEEN 1 AND 30));--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "cooling_off_days" integer;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "cooling_off_added" date;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "changed_mind" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_cooling_off_check" CHECK (("cooling_off_days" IS NULL OR ("price_minor" > 0 AND "cooling_off_days" BETWEEN 1 AND 30)) AND (("cooling_off_days" IS NULL) = ("cooling_off_added" IS NULL)) AND (NOT "changed_mind" OR ("cooling_off_days" IS NOT NULL AND "status" = 'cancelled')));--> statement-breakpoint
-- Overview's Refunds to review reads the few cancelled so, never a gym's whole history.
CREATE INDEX "gym_held_memberships_changed_mind_idx" ON "gym_held_memberships" USING btree ("gym_id") WHERE "changed_mind";
