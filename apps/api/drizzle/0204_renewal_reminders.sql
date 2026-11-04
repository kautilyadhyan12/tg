-- A reminder before a renewal or a minimum term's end (ROADMAP Stage 2 item 18v-iv; Kd, 2026-11-04,
-- `rulings/2026-11-04-18v-iv.md`). Forward-only. Hand-written, as `0016` onwards are; its journal entry
-- is part of this commit.
--
-- A repeating line of the price list with a price may email a reminder so many days before every renewal
-- (`every_renewal`), or before its minimum term ends (`term_end`, a line with one). It is read from the line
-- as it is now, so it covers everybody already on it; it is never copied to a membership.
ALTER TABLE "gym_membership_types" ADD COLUMN "renewal_reminder" text;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD COLUMN "renewal_reminder_days" integer;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_renewal_reminder_check" CHECK ((("renewal_reminder" IS NULL) = ("renewal_reminder_days" IS NULL)) AND ("renewal_reminder" IS NULL OR ("renewal_reminder" IN ('every_renewal','term_end') AND "renewal_reminder_days" IN (3,7,14,30,45,60) AND "kind" = 'recurring' AND "price_minor" > 0 AND ("renewal_reminder" = 'every_renewal' OR "contract_periods" IS NOT NULL))));--> statement-breakpoint
--
-- The day each gym's reminders were last looked for: once a gym's day, from 8 in the morning there, and
-- again the day a line's reminder is changed (set back to null).
ALTER TABLE "gyms" ADD COLUMN "renewal_reminders_checked_on" date;--> statement-breakpoint
--
-- One email a membership and occasion (`renew:<period>` before that period, `term` before its minimum
-- term's end), to whoever pays for it (`entry_id`, their record). The address is kept only while the email
-- waits to go, as the other email queues keep theirs. `about_on` is the day the email names: the renewal, or
-- the last day of the minimum term. A record deleted for good lets go of `entry_id` alone.
CREATE TABLE "gym_renewal_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"held_membership_id" uuid NOT NULL,
	"entry_id" uuid,
	"occasion" text NOT NULL,
	"what" text NOT NULL,
	"about_on" date NOT NULL,
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
	CONSTRAINT "gym_renewal_reminders_occasion_check" CHECK ("occasion" ~ '^(renew:[0-9]{1,5}|term)$'),
	CONSTRAINT "gym_renewal_reminders_what_check" CHECK ("what" IN ('renews','term_renews','ends')),
	CONSTRAINT "gym_renewal_reminders_state_check" CHECK ("state" IN ('queued','sending','sent','skipped','failed')),
	CONSTRAINT "gym_renewal_reminders_email_check" CHECK (("state" IN ('queued','sending') OR "email" IS NULL) AND ("email" IS NULL OR length("email") <= 254)),
	CONSTRAINT "gym_renewal_reminders_waiting_check" CHECK ("state" NOT IN ('queued','sending') OR "email" IS NOT NULL),
	CONSTRAINT "gym_renewal_reminders_lease_check" CHECK (("state" = 'sending') = ("lease_until" IS NOT NULL)),
	CONSTRAINT "gym_renewal_reminders_finished_check" CHECK (("state" IN ('sent','skipped','failed')) = ("finished_at" IS NOT NULL)),
	CONSTRAINT "gym_renewal_reminders_reason_check" CHECK ((("state" IN ('skipped','failed')) = ("reason" IS NOT NULL)) AND ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,40}$')),
	CONSTRAINT "gym_renewal_reminders_provider_check" CHECK ("provider_id" IS NULL OR ("state" = 'sent' AND length("provider_id") <= 100)),
	CONSTRAINT "gym_renewal_reminders_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "gym_renewal_reminders" ADD CONSTRAINT "gym_renewal_reminders_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_renewal_reminders" ADD CONSTRAINT "gym_renewal_reminders_held_fk" FOREIGN KEY ("gym_id","held_membership_id") REFERENCES "public"."gym_held_memberships"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_renewal_reminders" ADD CONSTRAINT "gym_renewal_reminders_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
-- One email a membership and occasion.
CREATE UNIQUE INDEX "gym_renewal_reminders_occasion_uq" ON "gym_renewal_reminders" USING btree ("gym_id","held_membership_id","occasion");--> statement-breakpoint
-- The worker's search for emails due.
CREATE INDEX "gym_renewal_reminders_due_idx" ON "gym_renewal_reminders" USING btree ("not_before","id") WHERE "state" IN ('queued','sending');--> statement-breakpoint
-- A record's page and the deleted-for-good step read a record's emails.
CREATE INDEX "gym_renewal_reminders_entry_idx" ON "gym_renewal_reminders" USING btree ("gym_id","entry_id");
