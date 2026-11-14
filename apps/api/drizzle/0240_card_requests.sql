-- Ask members to add their card (ROADMAP 18d-vii). Forward-only. Hand-written, as `0016` onwards
-- are. Its journal entry is part of this commit.
--
-- Each member asked is sent one message of the new kind `card_request` in their inbox; the row is
-- also the record that they were asked, and when, read by their page and by the box's "asked in
-- the last 7 days".
ALTER TABLE "gym_member_messages" DROP CONSTRAINT "gym_member_messages_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','review','class_reminder','group','referral_gift','card_request'));
--> statement-breakpoint
-- The email sent with each card request (Kd, 2026-11-14: members may not see it in the app), to the address on
-- the member's record, written with the message and sent by the worker; the address is cleared once it is done.
CREATE TABLE "gym_card_request_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid,
	"occasion" text NOT NULL,
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
	CONSTRAINT "gym_card_request_emails_occasion_check" CHECK ("occasion" ~ '^card:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "gym_card_request_emails_state_check" CHECK ("state" IN ('queued','sending','sent','skipped','failed')),
	CONSTRAINT "gym_card_request_emails_email_check" CHECK (("state" IN ('queued','sending') OR "email" IS NULL) AND ("email" IS NULL OR length("email") <= 254)),
	CONSTRAINT "gym_card_request_emails_waiting_check" CHECK ("state" NOT IN ('queued','sending') OR "email" IS NOT NULL),
	CONSTRAINT "gym_card_request_emails_lease_check" CHECK (("state" = 'sending') = ("lease_until" IS NOT NULL)),
	CONSTRAINT "gym_card_request_emails_finished_check" CHECK (("state" IN ('sent','skipped','failed')) = ("finished_at" IS NOT NULL)),
	CONSTRAINT "gym_card_request_emails_reason_check" CHECK ((("state" IN ('skipped','failed')) = ("reason" IS NOT NULL)) AND ("reason" IS NULL OR "reason" ~ '^[a-z_]{1,40}$')),
	CONSTRAINT "gym_card_request_emails_provider_check" CHECK ("provider_id" IS NULL OR ("state" = 'sent' AND length("provider_id") <= 100)),
	CONSTRAINT "gym_card_request_emails_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
ALTER TABLE "gym_card_request_emails" ADD CONSTRAINT "gym_card_request_emails_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_request_emails" ADD CONSTRAINT "gym_card_request_emails_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
-- One email a record and press.
CREATE UNIQUE INDEX "gym_card_request_emails_occasion_uq" ON "gym_card_request_emails" USING btree ("gym_id","entry_id","occasion");--> statement-breakpoint
-- The worker's search for emails due.
CREATE INDEX "gym_card_request_emails_due_idx" ON "gym_card_request_emails" USING btree ("not_before","id") WHERE "state" IN ('queued','sending');--> statement-breakpoint
-- A record's emails, for Delete permanently.
CREATE INDEX "gym_card_request_emails_entry_idx" ON "gym_card_request_emails" USING btree ("gym_id","entry_id");
