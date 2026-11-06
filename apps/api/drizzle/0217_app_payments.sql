-- Pay what they owe in the app (ROADMAP Stage 2 item 18k-ii-a; Kd, 2026-11-06; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member pays a membership's bill on Square's own payment page. One row a press, while the page is open and after:
-- `link_key` is the key Square made the page with, so asking again gives back the same page; `close_wanted_at`: the
-- member left it, staff pressed Close payment page, or `closes_at` passed, and whichever request asks Square next
-- deletes the page first (its order then CANCELED, so it can no longer be paid). While open, nothing else is paid,
-- voided or changed on the membership. A paid row is kept, for the card it names; a closed one is forgotten a day on.
--
-- `held_membership_id` has no link: the payment is recorded on whichever record holds the membership when Square
-- answers. A record deleted for good lets go of `entry_id` alone (as `0149`).
CREATE TABLE "gym_app_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid,
	"held_membership_id" uuid NOT NULL,
	"period_index" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"location_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"link_key" uuid NOT NULL,
	"link_id" text NOT NULL,
	"order_id" text NOT NULL,
	"url" text NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"close_wanted_at" timestamp with time zone,
	"close_wanted_by" text,
	"closed_by_staff" uuid,
	"checking_until" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"square_payment_id" text,
	"member_payment_id" uuid,
	"card_brand" text,
	"card_last4" text,
	"taken_minor" integer,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gym_app_payments_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_app_payments_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "location_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "link_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "order_id" ~ '^[A-Za-z0-9_-]{1,192}$' AND char_length("url") <= 300 AND ("square_payment_id" IS NULL OR "square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$')),
	CONSTRAINT "gym_app_payments_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999 AND "currency" ~ '^[A-Z]{3}$' AND "period_index" >= 0 AND "closes_at" > "opened_at"),
	CONSTRAINT "gym_app_payments_state_check" CHECK ("state" IN ('open','done')),
	CONSTRAINT "gym_app_payments_outcome_check" CHECK (("state" = 'open') = ("outcome" IS NULL AND "finished_at" IS NULL) AND ("outcome" IS NULL OR "outcome" IN ('paid','closed','not_recorded','gone','no_answer'))),
	-- Paid is a payment Square took and the one row it is on the bill as; not recorded is a payment Square took and
	-- nothing on the bill.
	CONSTRAINT "gym_app_payments_paid_check" CHECK ((("outcome" IS NOT DISTINCT FROM 'paid') = ("member_payment_id" IS NOT NULL)) AND ("outcome" NOT IN ('paid','not_recorded') OR "square_payment_id" IS NOT NULL)),
	CONSTRAINT "gym_app_payments_close_check" CHECK (("close_wanted_at" IS NULL) = ("close_wanted_by" IS NULL) AND ("close_wanted_by" IS NULL OR "close_wanted_by" IN ('member','staff','expired'))),
	-- What Square took, in the page's money: the bill's amount when paid, and what it really took when that could not go on the bill.
	CONSTRAINT "gym_app_payments_taken_check" CHECK ("taken_minor" IS NULL OR "taken_minor" BETWEEN 0 AND 99999999),
	CONSTRAINT "gym_app_payments_card_check" CHECK (("card_brand" IS NULL) = ("card_last4" IS NULL) AND ("card_last4" IS NULL OR "card_last4" ~ '^[0-9]{4}$') AND ("card_brand" IS NULL OR char_length("card_brand") <= 40))
);--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_closed_by_staff_users_id_fk" FOREIGN KEY ("closed_by_staff") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The same press sent twice is one page.
CREATE UNIQUE INDEX "gym_app_payments_request_uq" ON "gym_app_payments" USING btree ("gym_id","request_key");--> statement-breakpoint
-- One page is open for a membership at a time.
CREATE UNIQUE INDEX "gym_app_payments_membership_uq" ON "gym_app_payments" USING btree ("gym_id","held_membership_id") WHERE "state" = 'open';--> statement-breakpoint
-- One row a page, and a payment Square took is recorded once.
CREATE UNIQUE INDEX "gym_app_payments_link_uq" ON "gym_app_payments" USING btree ("environment","account_id","link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_app_payments_square_payment_uq" ON "gym_app_payments" USING btree ("environment","account_id","square_payment_id") WHERE "square_payment_id" IS NOT NULL;--> statement-breakpoint
-- The person's page reads the ones open for them; the worker the ones nobody is asking about; the page the card a payment names.
CREATE INDEX "gym_app_payments_entry_idx" ON "gym_app_payments" USING btree ("gym_id","entry_id") WHERE "state" = 'open';--> statement-breakpoint
CREATE INDEX "gym_app_payments_open_idx" ON "gym_app_payments" USING btree ("checked_at") WHERE "state" = 'open';--> statement-breakpoint
CREATE INDEX "gym_app_payments_member_payment_idx" ON "gym_app_payments" USING btree ("gym_id","member_payment_id") WHERE "member_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_app_payments_done_idx" ON "gym_app_payments" USING btree ("finished_at") WHERE "finished_at" IS NOT NULL AND "outcome" = 'closed';--> statement-breakpoint
-- A payment on the bill from the app names Square's payment, as one from the Terminal does; a refund of it reads as it.
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_method_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','link','company','terminal','app'));--> statement-breakpoint
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_provider_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_provider_check" CHECK (("method" IN ('company','terminal','app')) = ("provider" IS NOT NULL) AND ("provider" IS NULL) = ("provider_payment_id" IS NULL) AND ("provider" IS NULL OR (char_length("provider") BETWEEN 1 AND 40 AND char_length("provider_payment_id") BETWEEN 1 AND 200)));--> statement-breakpoint
ALTER TABLE "gym_member_refunds" DROP CONSTRAINT "gym_member_refunds_method_check";--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','company','terminal','app'));
