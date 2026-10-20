-- A member's card saved on Square's own form (ROADMAP Stage 2 item 18d-ii; spec Part 3 §14.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The card number goes from the browser or the phone to Square and never reaches us: we keep
-- Square's ids for the card and the customer, and what a screen shows of it (brand, last four,
-- expiry). Each row names the Square account it is in, so a gym connected to another account
-- since shows none of it.
--
-- The person a record is in a gym's Square account: made the first time a card is saved for
-- them, once, under a lock. A record deleted for good takes its rows with it.
CREATE TABLE "gym_square_customers" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_square_customers_pk" PRIMARY KEY("gym_id","entry_id","environment","account_id"),
	CONSTRAINT "gym_square_customers_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_customers_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$')
);--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD CONSTRAINT "gym_square_customers_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- What the person agreed to when a card was saved: the words shown, when, and on whose
-- screen (`desk`: staff's, `screen_user_id` the member of staff signed in; `app`: the
-- member's own). Kept apart from the card, so it outlives a removed card. A record deleted for
-- good lets go of it with the day, as a desk waiver does (0108): the purge removes it once
-- three years have passed since it was agreed and one since that day (California's
-- automatic renewal law keeps the consent for the longer of the two).
CREATE TABLE "gym_card_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid,
	"record_deleted_at" timestamp with time zone,
	"words" text NOT NULL,
	"screen" text NOT NULL,
	"screen_user_id" uuid,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"agreed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gym_card_agreements_words_check" CHECK (char_length("words") BETWEEN 20 AND 600),
	CONSTRAINT "gym_card_agreements_screen_check" CHECK ("screen" IN ('desk','app')),
	CONSTRAINT "gym_card_agreements_card_check" CHECK ("brand" ~ '^[A-Z_]{1,40}$' AND "last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "gym_card_agreements_deleted_day_check" CHECK ("entry_id" IS NOT NULL OR "record_deleted_at" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "gym_card_agreements" ADD CONSTRAINT "gym_card_agreements_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Checked when the transaction commits, as a desk signature's is (0108): a deletion that does
-- not let go of the agreement first is refused.
ALTER TABLE "gym_card_agreements" ADD CONSTRAINT "gym_card_agreements_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "gym_card_agreements" ADD CONSTRAINT "gym_card_agreements_screen_user_id_users_id_fk" FOREIGN KEY ("screen_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_card_agreements_entry_idx" ON "gym_card_agreements" USING btree ("gym_id","entry_id");--> statement-breakpoint
-- The purge's search for agreements whose time is up.
CREATE INDEX "gym_card_agreements_deleted_idx" ON "gym_card_agreements" USING btree ("record_deleted_at") WHERE "entry_id" IS NULL;--> statement-breakpoint
-- A record's card on file: one a record, a new one replacing the old. A Square card is on one
-- record only.
CREATE TABLE "gym_member_cards" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"card_id" text NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"exp_month" integer NOT NULL,
	"exp_year" integer NOT NULL,
	"saved_from" text NOT NULL,
	"saved_by" uuid,
	"agreement_id" uuid NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gym_member_cards_pk" PRIMARY KEY("gym_id","entry_id"),
	CONSTRAINT "gym_member_cards_card_uq" UNIQUE("environment","account_id","card_id"),
	CONSTRAINT "gym_member_cards_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_member_cards_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "card_id" ~ '^[A-Za-z0-9:_-]{1,192}$'),
	CONSTRAINT "gym_member_cards_card_check" CHECK ("brand" ~ '^[A-Z_]{1,40}$' AND "last4" ~ '^[0-9]{4}$' AND "exp_month" BETWEEN 1 AND 12 AND "exp_year" BETWEEN 2000 AND 2200),
	CONSTRAINT "gym_member_cards_saved_from_check" CHECK ("saved_from" IN ('desk','app'))
);--> statement-breakpoint
ALTER TABLE "gym_member_cards" ADD CONSTRAINT "gym_member_cards_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member_cards" ADD CONSTRAINT "gym_member_cards_agreement_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."gym_card_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member_cards" ADD CONSTRAINT "gym_member_cards_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Cards Square is still to be told to stop: one replaced by a newer card, or whose record was
-- deleted for good or joined to another. Written in the step that lets the card go and sent by
-- the worker until Square says so, with the gym's own connection to that account.
CREATE TABLE "gym_card_disables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"card_id" text NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_card_disables_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_card_disables_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "card_id" ~ '^[A-Za-z0-9:_-]{1,192}$'),
	CONSTRAINT "gym_card_disables_tries_check" CHECK ("tries" >= 0)
);--> statement-breakpoint
ALTER TABLE "gym_card_disables" ADD CONSTRAINT "gym_card_disables_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_card_disables_due_idx" ON "gym_card_disables" USING btree ("not_before");
