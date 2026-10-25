-- A payment taken in Square's own app, recorded on the member (ROADMAP Stage 2 item 18d-iii-b-i; spec
-- Part 3 §14.8). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- On the bill it is `square_app`, with Square's payment id, as the Terminal's and the card on file's
-- are. Staff can take one off the bill it was put on ("Not this bill", `not_this_bill`): its row is
-- kept, struck through, and the Square payment waits again. So one Square payment stands on one bill
-- at a time, and a payment taken back no longer holds its id.
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_method_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','link','company','terminal','square_app'));--> statement-breakpoint
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_provider_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_provider_check" CHECK (("method" IN ('company','terminal','square_app')) = ("provider" IS NOT NULL) AND ("provider" IS NULL) = ("provider_payment_id" IS NULL) AND ("provider" IS NULL OR (char_length("provider") BETWEEN 1 AND 40 AND char_length("provider_payment_id") BETWEEN 1 AND 200)));--> statement-breakpoint
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_void_reason_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_void_reason_check" CHECK ("void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','wrong_person','other','not_this_bill')));--> statement-breakpoint
DROP INDEX "gym_member_payments_provider_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "gym_member_payments_provider_uq" ON "gym_member_payments" USING btree ("gym_id","provider","provider_payment_id") WHERE "provider" IS NOT NULL AND "undone_at" IS NULL;--> statement-breakpoint
--
-- Every completed payment Square made at a location of a Square account a gym here is connected to,
-- that is not the app's own (a Terminal checkout's, a card on file's charge), once: what became of it.
-- `recorded`: on a bill (`member_payment_id`); `waiting`: for staff, with why (`reason`; `square_tax`: Square
-- added tax or a charge on top of what staff typed); `shop_sale`:
-- items from the gym's list in Square, no bill's. `gym_id` is null only where two gyms here use the
-- location and no customer says whose it is. `entry_id`: the record Square's customer is, where one
-- is; a record joined to another or deleted for good lets go of it alone (the payment on the bill
-- goes with the membership). `member_payment_id` has no link, as `gym_terminal_payments`' has none:
-- a gym archived takes its payments with its list. `record_key` is the request key the payment is
-- recorded with, a new one each time staff take it off a bill.
CREATE TABLE "gym_square_app_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"square_payment_id" text NOT NULL,
	"gym_id" uuid,
	"location_id" text NOT NULL,
	"customer_id" text,
	"amount_minor" integer NOT NULL,
	"tip_minor" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"source" text,
	"brand" text,
	"last4" text,
	"taken_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"entry_id" uuid,
	"member_payment_id" uuid,
	"record_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gym_square_app_payments_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_app_payments_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$' AND "location_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND ("customer_id" IS NULL OR "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$')),
	CONSTRAINT "gym_square_app_payments_amount_check" CHECK ("amount_minor" BETWEEN 0 AND 999999999 AND "tip_minor" BETWEEN 0 AND 999999999 AND "currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_square_app_payments_card_check" CHECK (("source" IS NULL OR "source" ~ '^[A-Z_]{1,40}$') AND ("brand" IS NULL OR "brand" ~ '^[A-Z_]{1,40}$') AND ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$')),
	CONSTRAINT "gym_square_app_payments_state_check" CHECK ("state" IN ('recorded','waiting','shop_sale')),
	CONSTRAINT "gym_square_app_payments_reason_check" CHECK (("state" = 'waiting') = ("reason" IS NOT NULL) AND ("reason" IS NULL OR "reason" IN ('no_customer','not_linked','several_people','mixed_sale','sale_unread','square_tax','no_bill','too_early','several_bills','busy','maybe_twice','other_location','several_gyms','not_this_bill'))),
	CONSTRAINT "gym_square_app_payments_recorded_check" CHECK (("state" = 'recorded') = ("member_payment_id" IS NOT NULL)),
	CONSTRAINT "gym_square_app_payments_gym_check" CHECK ("gym_id" IS NOT NULL OR ("state" = 'waiting' AND "reason" = 'several_gyms'))
);--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
-- A payment Square made is taken in once, whichever message or look found it.
CREATE UNIQUE INDEX "gym_square_app_payments_square_uq" ON "gym_square_app_payments" USING btree ("environment","account_id","square_payment_id");--> statement-breakpoint
-- A gym's payments by what became of them, newest first.
CREATE INDEX "gym_square_app_payments_gym_idx" ON "gym_square_app_payments" USING btree ("gym_id","state","taken_at");--> statement-breakpoint
CREATE INDEX "gym_square_app_payments_entry_idx" ON "gym_square_app_payments" USING btree ("gym_id","entry_id") WHERE "entry_id" IS NOT NULL;--> statement-breakpoint
--
-- The hourly look at the gym's Square payments, for any whose message never came (our server down
-- longer than Square sends them again): from `swept_until`, at the location it was made for. Square
-- payments made before `watching_since` are never taken in, by a message or a look: an old payment's
-- later message (a refund) is never put on a bill of today's. A connection moved to another account or
-- location starts again from the moment it moved.
CREATE TABLE "gym_square_payment_sweeps" (
	"gym_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"location_id" text NOT NULL,
	"watching_since" timestamp with time zone NOT NULL,
	"swept_until" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	CONSTRAINT "gym_square_payment_sweeps_pk" PRIMARY KEY("gym_id","environment"),
	CONSTRAINT "gym_square_payment_sweeps_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_payment_sweeps_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "location_id" ~ '^[A-Za-z0-9_-]{1,64}$')
);--> statement-breakpoint
ALTER TABLE "gym_square_payment_sweeps" ADD CONSTRAINT "gym_square_payment_sweeps_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_square_payment_sweeps_due_idx" ON "gym_square_payment_sweeps" USING btree ("due_at");--> statement-breakpoint
--
-- Square's customer on a payment, found among the ones the app keeps for records.
CREATE INDEX "gym_square_customers_customer_idx" ON "gym_square_customers" USING btree ("environment","account_id","customer_id") WHERE "customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_member_cards_customer_idx" ON "gym_member_cards" USING btree ("environment","account_id","customer_id");
