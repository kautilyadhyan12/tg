-- Refund to card (ROADMAP Stage 2 item 18d-iv-a; spec Part 3 §14.8): money given back to the card that paid, through Square,
-- from a payment taken on the Square Terminal or charged to the card on file. Forward-only. Hand-written, as `0016` onwards
-- are; its journal entry is part of this commit.
--
-- One row a press, kept: its id is the key Square is asked with, so the same press sent twice is one refund. `asking` is a
-- press Square has not answered; at most one on a payment. Once Square takes it up (`pending`, then `done`), a row of
-- `gym_member_refunds` holds the money as given back, as a refund noted by hand does, with the payment's own method. If Square
-- then says it failed, that row is voided with `square_failed`, by the app and not by anyone on staff.
CREATE TABLE "gym_square_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"payment_id" uuid NOT NULL,
	"member_refund_id" uuid,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"square_payment_id" text NOT NULL,
	"square_refund_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"brand" text,
	"last4" text,
	"request_key" uuid NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"code" text,
	"looks" integer DEFAULT 0 NOT NULL,
	"look_at" timestamp with time zone,
	"started_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"started_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"checking_until" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gym_square_refunds_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_square_refunds_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_refunds_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999 AND "currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_square_refunds_reason_check" CHECK ("reason" IN ('paid_twice','charged_too_much','leaving','other')),
	CONSTRAINT "gym_square_refunds_card_check" CHECK (("brand" IS NULL OR "brand" ~ '^[A-Z_]{1,40}$') AND ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$') AND ("brand" IS NULL) = ("last4" IS NULL)),
	CONSTRAINT "gym_square_refunds_ids_check" CHECK ("square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$' AND ("square_refund_id" IS NULL OR "square_refund_id" ~ '^[A-Za-z0-9_-]{1,255}$')),
	CONSTRAINT "gym_square_refunds_state_check" CHECK ("state" IN ('asking','pending','done')),
	CONSTRAINT "gym_square_refunds_outcome_check" CHECK (("state" = 'done') = ("outcome" IS NOT NULL) AND ("outcome" IS NULL OR "outcome" IN ('completed','failed','refused','lost'))),
	CONSTRAINT "gym_square_refunds_taken_up_check" CHECK (("state" = 'pending' OR COALESCE("outcome" IN ('completed','failed'), false)) = ("square_refund_id" IS NOT NULL)),
	CONSTRAINT "gym_square_refunds_code_check" CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9_]{1,60}$'),
	CONSTRAINT "gym_square_refunds_payment_fk" FOREIGN KEY ("gym_id", "payment_id") REFERENCES "gym_member_payments"("gym_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
-- One press waiting on a payment at a time, whatever the code in front of it does.
CREATE UNIQUE INDEX "gym_square_refunds_asking_uq" ON "gym_square_refunds" ("gym_id", "payment_id") WHERE "state" = 'asking';
--> statement-breakpoint
-- A refund of Square's is written down once.
CREATE UNIQUE INDEX "gym_square_refunds_refund_uq" ON "gym_square_refunds" ("environment", "square_refund_id") WHERE "square_refund_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "gym_square_refunds_payment_idx" ON "gym_square_refunds" ("gym_id", "payment_id");
--> statement-breakpoint
CREATE INDEX "gym_square_refunds_member_refund_idx" ON "gym_square_refunds" ("gym_id", "member_refund_id") WHERE "member_refund_id" IS NOT NULL;
--> statement-breakpoint
-- What the worker looks through each minute: only presses still open.
CREATE INDEX "gym_square_refunds_open_idx" ON "gym_square_refunds" ("environment", "state", "look_at") WHERE "state" <> 'done';
--> statement-breakpoint
-- A refund to the card reads as the payment's own way.
ALTER TABLE "gym_member_refunds" DROP CONSTRAINT "gym_member_refunds_method_check";
--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','company','terminal'));
--> statement-breakpoint
-- `square_failed`: written by the app when Square says a refund it took up has failed.
ALTER TABLE "gym_member_refunds" DROP CONSTRAINT "gym_member_refunds_void_reason_check";
--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_void_reason_check" CHECK ("void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','other','square_failed')));
