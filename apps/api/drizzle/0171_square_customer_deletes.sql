-- Delete permanently takes out of Square the customer the app added (ROADMAP Stage 2 item 18d-iii-b-ii-b-ii-b-ii; spec Part 3
-- §14.8). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `gym_square_customers.made_as`: the reference id the app gave the customer when it made it (the record's id then). Square
-- keeps it on the customer, so a customer Square shows now with another reference id is not the one the app made, and is
-- never deleted. A customer that was already in Square, and linked, has none. Set when the app claims the customer; every
-- customer the app made before this is marked by the last statement.
--
-- `gym_square_customer_deletes`: customers Square is still to be told to delete, written in the step that deletes a record for
-- good (the record, and with it its link to the customer, is gone from then on) and sent by the worker until Square says so.
-- Square's id and the reference id the customer was made with: never a name, an email or a phone. `customer_id` null: the
-- answer to making the customer was lost and the app never learnt its id; the worker finds it by its reference id. Written
-- once for a customer (`reference_id` is the record's).
ALTER TABLE "gym_square_customers" ADD COLUMN "made_as" uuid;
--> statement-breakpoint
CREATE TABLE "gym_square_customer_deletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"customer_id" text,
	"reference_id" uuid NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_square_customer_deletes_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_customer_deletes_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND ("customer_id" IS NULL OR "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$')),
	CONSTRAINT "gym_square_customer_deletes_tries_check" CHECK ("tries" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gym_square_customer_deletes" ADD CONSTRAINT "gym_square_customer_deletes_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "gym_square_customer_deletes_reference_uq" ON "gym_square_customer_deletes" USING btree ("gym_id","environment","account_id","reference_id");
--> statement-breakpoint
CREATE INDEX "gym_square_customer_deletes_due_idx" ON "gym_square_customer_deletes" USING btree ("not_before");
--> statement-breakpoint
-- Every customer the app made before this carries the record's id, which is what it was made with.
UPDATE "gym_square_customers" SET "made_as" = "entry_id" WHERE "joined_at" IS NULL AND "made_as" IS NULL;
