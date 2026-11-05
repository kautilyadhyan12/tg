-- Several taxes on a membership (ROADMAP Stage 2 item 18b-v-b; Kd, 2026-11-05, `rulings/2026-11-05-18b-v-a.md`).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A membership type charges as many of the gym's rates as it needs, in the order they were picked
-- (`position`), each once; together at most 30%, which the server checks under the gym's lock, as it
-- checks a rate is the gym's. A type's one rate is its first. A rate removed, or a type, takes its rows
-- with it: a rate a live type charges is never removed (`taxRepo.removeRate`), so only an archived type
-- loses one, as before.
CREATE TABLE "gym_membership_type_tax_rates" (
	"gym_id" uuid NOT NULL,
	"membership_type_id" uuid NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "gym_membership_type_tax_rates_pk" PRIMARY KEY ("membership_type_id", "tax_rate_id"),
	CONSTRAINT "gym_membership_type_tax_rates_type_fk" FOREIGN KEY ("gym_id", "membership_type_id") REFERENCES "gym_membership_types" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_membership_type_tax_rates_rate_fk" FOREIGN KEY ("gym_id", "tax_rate_id") REFERENCES "gym_tax_rates" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_membership_type_tax_rates_position_check" CHECK ("position" >= 1)
);--> statement-breakpoint
CREATE INDEX "gym_membership_type_tax_rates_rate_idx" ON "gym_membership_type_tax_rates" ("gym_id", "tax_rate_id");--> statement-breakpoint
INSERT INTO "gym_membership_type_tax_rates" ("gym_id", "membership_type_id", "tax_rate_id", "position")
SELECT "gym_id", "id", "tax_rate_id", 1 FROM "gym_membership_types" WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX "gym_membership_types_tax_rate_idx";--> statement-breakpoint
ALTER TABLE "gym_membership_types" DROP CONSTRAINT "gym_membership_types_tax_rate_fk";--> statement-breakpoint
ALTER TABLE "gym_membership_types" DROP COLUMN "tax_rate_id";--> statement-breakpoint
--
-- A membership keeps the rates it was sold with, in its type's order then, as it keeps its price: a type
-- changed later moves nobody already holding it (18b-iii). Each rate's percentage is charged as it is the
-- day a bill opens. Whether its price held them stays `tax_included`, set wherever it has a rate.
CREATE TABLE "gym_held_membership_tax_rates" (
	"gym_id" uuid NOT NULL,
	"held_membership_id" uuid NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "gym_held_membership_tax_rates_pk" PRIMARY KEY ("held_membership_id", "tax_rate_id"),
	CONSTRAINT "gym_held_membership_tax_rates_held_fk" FOREIGN KEY ("gym_id", "held_membership_id") REFERENCES "gym_held_memberships" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_held_membership_tax_rates_rate_fk" FOREIGN KEY ("gym_id", "tax_rate_id") REFERENCES "gym_tax_rates" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_held_membership_tax_rates_position_check" CHECK ("position" >= 1)
);--> statement-breakpoint
CREATE INDEX "gym_held_membership_tax_rates_rate_idx" ON "gym_held_membership_tax_rates" ("gym_id", "tax_rate_id");--> statement-breakpoint
INSERT INTO "gym_held_membership_tax_rates" ("gym_id", "held_membership_id", "tax_rate_id", "position")
SELECT "gym_id", "id", "tax_rate_id", 1 FROM "gym_held_memberships" WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" DROP CONSTRAINT "gym_held_memberships_tax_included_check";--> statement-breakpoint
DROP INDEX "gym_held_memberships_tax_rate_idx";--> statement-breakpoint
ALTER TABLE "gym_held_memberships" DROP CONSTRAINT "gym_held_memberships_tax_rate_fk";--> statement-breakpoint
ALTER TABLE "gym_held_memberships" DROP COLUMN "tax_rate_id";--> statement-breakpoint
--
-- A bill keeps each tax it was opened with, by its name and rate then and how much (`taxes`, in the order
-- its membership charged them): a bill and its receipt name each one, as Revenu Québec's "Showing the
-- Taxes" asks of GST and QST. `tax_pcm` and `tax_minor` stay the bill's whole tax, added up, and
-- `tax_included` whether its price held them. A bill opened before keeps its one tax in `taxes`; its
-- name was `tax_name`, which goes: one name cannot say two taxes.
ALTER TABLE "gym_member_bills" ADD COLUMN "taxes" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
UPDATE "gym_member_bills"
SET "taxes" = jsonb_build_array(jsonb_build_object('name', "tax_name", 'pcm', "tax_pcm", 'minor', "tax_minor"))
WHERE "tax_pcm" > 0;--> statement-breakpoint
ALTER TABLE "gym_member_bills" DROP CONSTRAINT "gym_member_bills_tax_check";--> statement-breakpoint
ALTER TABLE "gym_member_bills" DROP COLUMN "tax_name";--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_tax_check" CHECK (
	"tax_pcm" BETWEEN 0 AND 30000
	AND ("tax_included" IS NULL) = ("tax_pcm" = 0)
	AND "tax_minor" >= 0 AND "tax_minor" < "amount_minor"
	AND ("tax_pcm" > 0 OR "tax_minor" = 0)
	AND jsonb_typeof("taxes") = 'array' AND jsonb_array_length("taxes") <= 10
	AND ("tax_pcm" > 0) = (jsonb_array_length("taxes") > 0)
);
