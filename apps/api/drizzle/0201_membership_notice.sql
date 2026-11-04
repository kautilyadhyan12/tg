-- A notice to cancel on a repeating membership (ROADMAP Stage 2 item 18v-ii-a; Kd, 2026-11-04,
-- `rulings/2026-11-04-18v-ii-a.md`). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- A line of the price list may hold a notice to cancel in days (`notice_days`). A membership given
-- from it copies it, as it copies the minimum term. Staff giving notice set `stops_after`: the
-- periods it still renews and is paid for, then it stops. A membership ended before its notice
-- allowed, outside a minimum term, keeps the reason staff gave (`notice_waived`).
ALTER TABLE "gym_membership_types" ADD COLUMN "notice_days" integer;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_notice_check" CHECK ("notice_days" IS NULL OR ("kind" = 'recurring' AND "price_minor" > 0 AND "notice_days" BETWEEN 1 AND 90));--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "notice_days" integer;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "stops_after" integer;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "notice_waived" text;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_notice_check" CHECK (("notice_days" IS NULL OR ("kind" = 'recurring' AND "notice_days" BETWEEN 1 AND 90)) AND ("stops_after" IS NULL OR ("notice_days" IS NOT NULL AND "stops_after" BETWEEN 1 AND 1000)) AND ("notice_waived" IS NULL OR ("notice_waived" IN ('moved','medical','death','other') AND "notice_days" IS NOT NULL AND ("status" = 'cancelled' OR NOT "renews"))));
