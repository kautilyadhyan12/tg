-- Raise the price for members already on a line (ROADMAP Stage 2 item 18w; Kd, 2026-10-22 and 2026-11-06,
-- `rulings/2026-11-06-18w.md`). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of
-- this commit.
--
-- One raise a membership: the price it goes to (its own price, as `gym_held_memberships.price_minor` holds it) and
-- the days of notice. `from_period` is the first period charged at it, written with `from_on` (the payment the
-- email named) and `sent_on` (the gym's day) only once the email has gone: until then nothing is charged at it.
-- A later raise of the same membership takes the place of one not yet emailed; one emailed whose first payment
-- has been billed becomes the membership's own price first.
CREATE TABLE "gym_price_raises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"held_membership_id" uuid NOT NULL,
	"price_minor" integer NOT NULL,
	"notice_days" integer NOT NULL,
	"raised_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"from_period" integer,
	"from_on" date,
	"sent_on" date,
	CONSTRAINT "gym_price_raises_price_check" CHECK ("price_minor" BETWEEN 1 AND 99999999),
	CONSTRAINT "gym_price_raises_notice_check" CHECK ("notice_days" IN (7,14,30)),
	CONSTRAINT "gym_price_raises_sent_check" CHECK (("from_period" IS NULL) = ("from_on" IS NULL) AND ("from_period" IS NULL) = ("sent_on" IS NULL) AND ("from_period" IS NULL OR "from_period" >= 1))
);--> statement-breakpoint
ALTER TABLE "gym_price_raises" ADD CONSTRAINT "gym_price_raises_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_price_raises" ADD CONSTRAINT "gym_price_raises_held_fk" FOREIGN KEY ("gym_id","held_membership_id") REFERENCES "public"."gym_held_memberships"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_price_raises" ADD CONSTRAINT "gym_price_raises_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_price_raises_held_uq" ON "gym_price_raises" USING btree ("gym_id","held_membership_id");--> statement-breakpoint
-- The hourly look reads the raises still to email.
CREATE INDEX "gym_price_raises_waiting_idx" ON "gym_price_raises" USING btree ("gym_id") WHERE "from_period" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_price_raises_raised_by_idx" ON "gym_price_raises" USING btree ("raised_by") WHERE "raised_by" IS NOT NULL;--> statement-breakpoint
--
-- When each gym's raises still to email were last looked at: every hour from 8 in the morning there.
ALTER TABLE "gyms" ADD COLUMN "price_raises_checked_at" timestamp with time zone;--> statement-breakpoint
--
-- The raise's email goes through the renewal reminders' queue, one a raise (`price:<raise id>`).
ALTER TABLE "gym_renewal_reminders" DROP CONSTRAINT "gym_renewal_reminders_occasion_check";--> statement-breakpoint
ALTER TABLE "gym_renewal_reminders" ADD CONSTRAINT "gym_renewal_reminders_occasion_check" CHECK ("occasion" ~ '^(renew:[0-9]{1,5}|term|price:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');--> statement-breakpoint
ALTER TABLE "gym_renewal_reminders" DROP CONSTRAINT "gym_renewal_reminders_what_check";--> statement-breakpoint
ALTER TABLE "gym_renewal_reminders" ADD CONSTRAINT "gym_renewal_reminders_what_check" CHECK ("what" IN ('renews','term_renews','ends','price'));
