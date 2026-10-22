-- Take payment on Terminal (ROADMAP Stage 2 item 18d-vi-a; spec Part 3 §14.8).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A bill paid on the gym's Square Terminal: the amount goes to the Terminal (Square's Terminal
-- checkout), the person taps, inserts or swipes their card, and the payment Square took is
-- recorded on the bill as `terminal`, with Square's payment id. One row a press, while it waits
-- and for a day after; one that Square took money for but could not be recorded is kept. The key
-- the checkout is asked with is kept, so asking again gives back the same checkout.
-- `cancel_wanted_at`: staff pressed Cancel, and whichever request asks Square next stops the
-- Terminal first; `cancel_too_late`: Square refused, as the person was paying.
--
-- `held_membership_id` has no link: the payment is recorded on whichever record holds the
-- membership when Square answers, and a membership gone by then leaves the row to say so.
-- A record deleted for good lets go of `entry_id` alone (as `0148`).
CREATE TABLE "gym_terminal_payments" (
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
	"device_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"checkout_key" uuid NOT NULL,
	"checkout_id" text,
	"picked_up" boolean DEFAULT false NOT NULL,
	"square_payment_id" text,
	"member_payment_id" uuid,
	"started_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"checking_until" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"cancel_wanted_at" timestamp with time zone,
	"cancel_too_late" boolean DEFAULT false NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gym_terminal_payments_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_terminal_payments_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "location_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "device_id" ~ '^[A-Za-z0-9:_-]{1,100}$' AND ("checkout_id" IS NULL OR "checkout_id" ~ '^[A-Za-z0-9:_-]{1,255}$') AND ("square_payment_id" IS NULL OR "square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$')),
	CONSTRAINT "gym_terminal_payments_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999 AND "currency" ~ '^[A-Z]{3}$' AND "period_index" >= 0),
	CONSTRAINT "gym_terminal_payments_state_check" CHECK ("state" IN ('waiting','done')),
	CONSTRAINT "gym_terminal_payments_outcome_check" CHECK (("state" = 'waiting') = ("outcome" IS NULL AND "finished_at" IS NULL) AND ("outcome" IS NULL OR "outcome" IN ('paid','cancelled_on_terminal','timed_out','no_answer','cancelled','refused','gone','not_recorded'))),
	-- Paid is a payment Square took and the one row it is on the bill as; not recorded is a
	-- payment Square took and nothing on the bill.
	CONSTRAINT "gym_terminal_payments_paid_check" CHECK ((("outcome" IS NOT DISTINCT FROM 'paid') = ("member_payment_id" IS NOT NULL)) AND ("outcome" NOT IN ('paid','not_recorded') OR "square_payment_id" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_terminal_payments" ADD CONSTRAINT "gym_terminal_payments_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The same press sent twice is one payment.
CREATE UNIQUE INDEX "gym_terminal_payments_request_uq" ON "gym_terminal_payments" USING btree ("gym_id","request_key");--> statement-breakpoint
-- A Terminal takes one payment at a time, whichever gym on its Square account asked.
CREATE UNIQUE INDEX "gym_terminal_payments_device_uq" ON "gym_terminal_payments" USING btree ("environment","account_id","device_id") WHERE "state" = 'waiting';--> statement-breakpoint
-- One payment waits for a membership at a time.
CREATE UNIQUE INDEX "gym_terminal_payments_membership_uq" ON "gym_terminal_payments" USING btree ("gym_id","held_membership_id") WHERE "state" = 'waiting';--> statement-breakpoint
-- A payment Square took is recorded once.
CREATE UNIQUE INDEX "gym_terminal_payments_square_payment_uq" ON "gym_terminal_payments" USING btree ("environment","account_id","square_payment_id") WHERE "square_payment_id" IS NOT NULL;--> statement-breakpoint
-- The person's page reads the ones waiting for them.
CREATE INDEX "gym_terminal_payments_entry_idx" ON "gym_terminal_payments" USING btree ("gym_id","entry_id") WHERE "state" = 'waiting';--> statement-breakpoint
-- The worker's search for payments nobody is asking about, and for done ones to forget.
CREATE INDEX "gym_terminal_payments_open_idx" ON "gym_terminal_payments" USING btree ("checked_at") WHERE "state" = 'waiting';--> statement-breakpoint
CREATE INDEX "gym_terminal_payments_done_idx" ON "gym_terminal_payments" USING btree ("finished_at") WHERE "finished_at" IS NOT NULL;--> statement-breakpoint
-- A payment on the bill from the Terminal names Square's payment, as one from a payment
-- company does.
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_method_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_method_check" CHECK ("method" IN ('cash','card_at_desk','bank_transfer','link','company','terminal'));--> statement-breakpoint
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_provider_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_provider_check" CHECK (("method" IN ('company','terminal')) = ("provider" IS NOT NULL) AND ("provider" IS NULL) = ("provider_payment_id" IS NULL) AND ("provider" IS NULL OR (char_length("provider") BETWEEN 1 AND 40 AND char_length("provider_payment_id") BETWEEN 1 AND 200)));
