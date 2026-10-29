-- Unlink on their page, the second half of Match once for the rest (ROADMAP Stage 2 item 18d-iii-b-ii-c-ii; spec Part 3 §14.8).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `gym_square_customers.matched_at`: the record's customer was linked by Match from a payment (0173's "linked"), not by
-- Members in Square, a card or a merge; only such a link is offered for Unlink. No link made by Match is left anywhere to mark:
-- Match merged on 2026-10-29 and was tried only on the web folder's database, where none is left (checked that day).
--
-- `gym_square_unlinked_customers`: staff unlinked this Square customer from this record, so nothing links it to them again by
-- itself (Members in Square's check and its own look, Match's tick on by itself, a card save under way). Only staff ticking
-- Match's link again for that person takes it away. Square's ids, never a person's details. `request_key` and what the press did
-- (`moved`, the card stopped) answer the same press sent twice the same. It goes with its record.
ALTER TABLE "gym_square_customers" ADD COLUMN "matched_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "gym_square_unlinked_customers" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"unlinked_at" timestamp with time zone NOT NULL,
	"unlinked_by" uuid,
	"request_key" uuid NOT NULL,
	"moved" integer DEFAULT 0 NOT NULL,
	"card_brand" text,
	"card_last4" text,
	CONSTRAINT "gym_square_unlinked_customers_pk" PRIMARY KEY("gym_id","environment","account_id","customer_id","entry_id"),
	CONSTRAINT "gym_square_unlinked_customers_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "gym_member_list_entries"("gym_id","id") ON DELETE CASCADE,
	CONSTRAINT "gym_square_unlinked_customers_by_fk" FOREIGN KEY ("unlinked_by") REFERENCES "users"("id") ON DELETE SET NULL,
	CONSTRAINT "gym_square_unlinked_customers_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_unlinked_customers_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "gym_square_unlinked_customers_moved_check" CHECK ("moved" >= 0),
	CONSTRAINT "gym_square_unlinked_customers_card_check" CHECK (("card_brand" IS NULL) = ("card_last4" IS NULL) AND ("card_brand" IS NULL OR "card_brand" ~ '^[A-Z_]{1,40}$') AND ("card_last4" IS NULL OR "card_last4" ~ '^[0-9]{4}$'))
);
--> statement-breakpoint
CREATE INDEX "gym_square_unlinked_customers_customer_idx" ON "gym_square_unlinked_customers" USING btree ("environment","account_id","customer_id");
