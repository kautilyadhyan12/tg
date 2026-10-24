-- A reminder before a card expires (ROADMAP Stage 2 item 18d-iii-c; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `card_expiry_reminders`: the gym's own choice, off until it switches it on (Kd, 2026-10-22).
ALTER TABLE "gyms" ADD COLUMN "card_expiry_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
--
-- One email a card and expiry date: written from 6 in the morning, gym time, of the month the card
-- expires, for a card on file in the Square account the gym is connected to whose holder pays for a
-- membership that renews. A card Square updates with a new date is another row, in its own month.
-- The address is kept only while the email waits to go (a CHECK), as the other email queues keep
-- theirs; a holder with no address on their record gets none (the box in Bills says so). A record deleted for
-- good lets go of `entry_id` alone.
CREATE TABLE "gym_card_expiry_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"card_id" text NOT NULL,
	"exp_month" integer NOT NULL,
	"exp_year" integer NOT NULL,
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
	CONSTRAINT "gym_card_expiry_notices_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_card_expiry_notices_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "card_id" ~ '^[A-Za-z0-9:_-]{1,192}$'),
	CONSTRAINT "gym_card_expiry_notices_expiry_check" CHECK ("exp_month" BETWEEN 1 AND 12 AND "exp_year" BETWEEN 2000 AND 2200),
	CONSTRAINT "gym_card_expiry_notices_state_check" CHECK ("state" IN ('queued','sending','sent','skipped','failed')),
	CONSTRAINT "gym_card_expiry_notices_email_check" CHECK (("state" IN ('queued','sending') OR "email" IS NULL) AND ("email" IS NULL OR length("email") <= 254)),
	CONSTRAINT "gym_card_expiry_notices_waiting_check" CHECK ("state" NOT IN ('queued','sending') OR "email" IS NOT NULL),
	CONSTRAINT "gym_card_expiry_notices_lease_check" CHECK (("state" = 'sending') = ("lease_until" IS NOT NULL)),
	CONSTRAINT "gym_card_expiry_notices_finished_check" CHECK (("state" IN ('sent','skipped','failed')) = ("finished_at" IS NOT NULL)),
	CONSTRAINT "gym_card_expiry_notices_reason_check" CHECK ((("state" IN ('skipped','failed')) = ("reason" IS NOT NULL)) AND ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,40}$')),
	CONSTRAINT "gym_card_expiry_notices_provider_check" CHECK ("provider_id" IS NULL OR ("state" = 'sent' AND length("provider_id") <= 100)),
	CONSTRAINT "gym_card_expiry_notices_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "gym_card_expiry_notices" ADD CONSTRAINT "gym_card_expiry_notices_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_expiry_notices" ADD CONSTRAINT "gym_card_expiry_notices_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
-- One email a card and expiry date.
CREATE UNIQUE INDEX "gym_card_expiry_notices_card_uq" ON "gym_card_expiry_notices" USING btree ("gym_id","environment","account_id","card_id","exp_year","exp_month");--> statement-breakpoint
-- The worker's search for emails due.
CREATE INDEX "gym_card_expiry_notices_due_idx" ON "gym_card_expiry_notices" USING btree ("not_before","id") WHERE "state" IN ('queued','sending');--> statement-breakpoint
-- A record's page and the deleted-for-good step read a record's emails.
CREATE INDEX "gym_card_expiry_notices_entry_idx" ON "gym_card_expiry_notices" USING btree ("gym_id","entry_id");
