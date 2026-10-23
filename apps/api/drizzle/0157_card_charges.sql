-- The saved card charged on the bill's date (ROADMAP Stage 2 item 18d-iii-i; spec Part 3 §14.8).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row a charge to a card on file: the app's own on a renewing membership's bill or a freeze
-- fee on its date (`by_schedule`), or staff pressing Charge card on file. `payment_key` is the key
-- Square is asked with, so asking again gives back the same payment, never a second one: the
-- bill's own id for the app's charge, the row's id for a press. While a row is `charging` nothing
-- else pays, voids or cancels that membership's bills. Rows are kept: a bill reads "declined" from
-- its newest one, and a payment its card.
--
-- `bill_id` is null only for a press paying a period whose bill is not open yet: the payment opens
-- it, as a payment by hand does.
-- `held_membership_id` and `bill_id` have no link: the money is recorded on whichever record holds
-- the membership when Square answers, and a bill gone by then leaves the row to say so. A record
-- deleted for good lets go of `entry_id` and `payer_entry_id` alone (as `0149`).
CREATE TABLE "gym_card_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid,
	"held_membership_id" uuid NOT NULL,
	"bill_id" uuid,
	"period_index" integer,
	"payer_entry_id" uuid,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"location_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"card_id" text NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"by_schedule" boolean NOT NULL,
	"request_key" uuid NOT NULL,
	"payment_key" text NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"decline_code" text,
	"square_payment_id" text,
	"member_payment_id" uuid,
	"started_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"checking_until" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gym_card_charges_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_card_charges_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "location_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "card_id" ~ '^[A-Za-z0-9:_-]{1,192}$' AND ("square_payment_id" IS NULL OR "square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$') AND char_length("payment_key") BETWEEN 1 AND 45),
	CONSTRAINT "gym_card_charges_card_check" CHECK ("brand" ~ '^[A-Z_]{1,40}$' AND "last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "gym_card_charges_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999 AND "currency" ~ '^[A-Z]{3}$' AND ("period_index" IS NULL OR "period_index" >= 0)),
	-- The app's own charge has nobody behind it; a press has whoever pressed, while they are in the app.
	CONSTRAINT "gym_card_charges_by_check" CHECK (NOT "by_schedule" OR ("started_by" IS NULL AND "bill_id" IS NOT NULL)),
	CONSTRAINT "gym_card_charges_bill_check" CHECK ("bill_id" IS NOT NULL OR "period_index" IS NOT NULL),
	CONSTRAINT "gym_card_charges_state_check" CHECK ("state" IN ('charging','done') AND ("state" = 'charging') = ("outcome" IS NULL AND "finished_at" IS NULL) AND ("outcome" IS NULL OR "outcome" IN ('paid','declined','refused','not_recorded','gone'))),
	-- Paid is a payment Square took and the one row it is on the bill as; not recorded is a payment
	-- Square took and nothing on the bill. Declined and refused keep Square's code.
	CONSTRAINT "gym_card_charges_paid_check" CHECK ((("outcome" IS NOT DISTINCT FROM 'paid') = ("member_payment_id" IS NOT NULL)) AND ("outcome" NOT IN ('paid','not_recorded') OR "square_payment_id" IS NOT NULL)),
	CONSTRAINT "gym_card_charges_decline_check" CHECK (("decline_code" IS NULL OR ("outcome" IN ('declined','refused') AND "decline_code" ~ '^[A-Z0-9_]{1,60}$')) AND ("outcome" IS DISTINCT FROM 'declined' OR "decline_code" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "gym_card_charges" ADD CONSTRAINT "gym_card_charges_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_charges" ADD CONSTRAINT "gym_card_charges_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_charges" ADD CONSTRAINT "gym_card_charges_payer_fk" FOREIGN KEY ("gym_id","payer_entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("payer_entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_card_charges" ADD CONSTRAINT "gym_card_charges_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The same press sent twice is one charge.
CREATE UNIQUE INDEX "gym_card_charges_request_uq" ON "gym_card_charges" USING btree ("gym_id","request_key");--> statement-breakpoint
-- One row a key Square is asked with.
CREATE UNIQUE INDEX "gym_card_charges_payment_key_uq" ON "gym_card_charges" USING btree ("environment","account_id","payment_key");--> statement-breakpoint
-- The app charges a bill by itself once.
CREATE UNIQUE INDEX "gym_card_charges_schedule_uq" ON "gym_card_charges" USING btree ("gym_id","bill_id") WHERE "by_schedule";--> statement-breakpoint
-- One charge is out for a membership at a time.
CREATE UNIQUE INDEX "gym_card_charges_membership_uq" ON "gym_card_charges" USING btree ("gym_id","held_membership_id") WHERE "state" = 'charging';--> statement-breakpoint
-- A payment Square took is recorded once.
CREATE UNIQUE INDEX "gym_card_charges_square_payment_uq" ON "gym_card_charges" USING btree ("environment","account_id","square_payment_id") WHERE "square_payment_id" IS NOT NULL;--> statement-breakpoint
-- A bill's newest charge, for its page.
CREATE INDEX "gym_card_charges_bill_idx" ON "gym_card_charges" USING btree ("gym_id","bill_id","started_at");--> statement-breakpoint
-- The worker's search for charges Square has not answered.
CREATE INDEX "gym_card_charges_open_idx" ON "gym_card_charges" USING btree ("checked_at") WHERE "state" = 'charging';
