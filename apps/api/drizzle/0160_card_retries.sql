-- A declined card tried again, and the cardholder told (ROADMAP Stage 2 item 18d-iii-ii-a; spec
-- Part 3 §14.8). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- `next_try_on`: on a decline the app will try again by itself (`cardRetries.ts` in @app/shared),
-- the gym day it does; cleared when the next charge of that bill starts. The app's own tries of one
-- bill are asked of Square with the bill's id, then `<bill id>:2` and `<bill id>:3`, so each try is
-- taken once however often it is asked: the old "one app charge a bill" index becomes "one row a
-- key the app asks with".
ALTER TABLE "gym_card_charges" ADD COLUMN "next_try_on" date;--> statement-breakpoint
ALTER TABLE "gym_card_charges" ADD CONSTRAINT "gym_card_charges_next_try_check" CHECK ("next_try_on" IS NULL OR "outcome" = 'declined');--> statement-breakpoint
DROP INDEX "gym_card_charges_schedule_uq";--> statement-breakpoint
-- The app takes each of its tries of a bill once.
CREATE UNIQUE INDEX "gym_card_charges_schedule_uq" ON "gym_card_charges" USING btree ("gym_id","payment_key") WHERE "by_schedule";--> statement-breakpoint
-- A card declined for good is found by the card, for every bill of the gym.
CREATE INDEX "gym_card_charges_card_idx" ON "gym_card_charges" USING btree ("gym_id","card_id") WHERE "outcome" = 'declined';--> statement-breakpoint
-- The worker's search for declines due a try.
CREATE INDEX "gym_card_charges_retry_idx" ON "gym_card_charges" USING btree ("next_try_on") WHERE "next_try_on" IS NOT NULL;--> statement-breakpoint
--
-- One email a period of a membership, or one a fee, written with its first decline, telling whoever's
-- card it is that the payment did not go through and to pay another way within 7 days (Visa). A
-- period's is kept by the period, so a press paying ahead, before the bill is open, is told too
-- (`bill_id` null); a fee's by its bill. The address is kept only while the email waits to go (a
-- CHECK), as the other email queues keep theirs. `skipped` with `no_email`: the cardholder's record
-- has no address, and the bill tells staff to tell them. The membership and the bill have no link,
-- as `gym_card_charges`' have none; a record deleted for good lets go of `entry_id` alone.
CREATE TABLE "gym_card_decline_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"held_membership_id" uuid NOT NULL,
	"period_index" integer,
	"bill_id" uuid,
	"charge_id" uuid NOT NULL,
	"entry_id" uuid,
	"email" "citext",
	"state" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"maybe_sent_at" timestamp with time zone,
	"provider_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gym_card_decline_notices_target_check" CHECK (("period_index" IS NULL) = ("bill_id" IS NOT NULL) AND ("period_index" IS NULL OR "period_index" >= 0)),
	CONSTRAINT "gym_card_decline_notices_state_check" CHECK ("state" IN ('queued','sending','sent','skipped','failed')),
	CONSTRAINT "gym_card_decline_notices_email_check" CHECK (("state" IN ('queued','sending') OR "email" IS NULL) AND ("email" IS NULL OR length("email") <= 254)),
	CONSTRAINT "gym_card_decline_notices_waiting_check" CHECK ("state" NOT IN ('queued','sending') OR "email" IS NOT NULL),
	CONSTRAINT "gym_card_decline_notices_lease_check" CHECK (("state" = 'sending') = ("lease_until" IS NOT NULL)),
	CONSTRAINT "gym_card_decline_notices_finished_check" CHECK (("state" IN ('sent','skipped','failed')) = ("finished_at" IS NOT NULL)),
	CONSTRAINT "gym_card_decline_notices_reason_check" CHECK ((("state" IN ('skipped','failed')) = ("reason" IS NOT NULL)) AND ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,40}$')),
	CONSTRAINT "gym_card_decline_notices_provider_check" CHECK ("provider_id" IS NULL OR ("state" = 'sent' AND length("provider_id") <= 100)),
	CONSTRAINT "gym_card_decline_notices_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "gym_card_decline_notices" ADD CONSTRAINT "gym_card_decline_notices_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_decline_notices" ADD CONSTRAINT "gym_card_decline_notices_charge_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."gym_card_charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_decline_notices" ADD CONSTRAINT "gym_card_decline_notices_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
-- One email a period of a membership, and one a fee.
CREATE UNIQUE INDEX "gym_card_decline_notices_period_uq" ON "gym_card_decline_notices" USING btree ("gym_id","held_membership_id","period_index") WHERE "period_index" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_card_decline_notices_fee_uq" ON "gym_card_decline_notices" USING btree ("gym_id","bill_id") WHERE "bill_id" IS NOT NULL;--> statement-breakpoint
-- The worker's search for emails due.
CREATE INDEX "gym_card_decline_notices_due_idx" ON "gym_card_decline_notices" USING btree ("not_before","id") WHERE "state" IN ('queued','sending');--> statement-breakpoint
-- The app's daily count of emails sent.
CREATE INDEX "gym_card_decline_notices_sent_idx" ON "gym_card_decline_notices" USING btree ("finished_at") WHERE "state" = 'sent';
