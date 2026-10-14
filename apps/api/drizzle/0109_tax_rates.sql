-- Named tax rates, and tax on memberships (ROADMAP Stage 2 item 18b-iii; spec Part 3 §14.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.

-- A gym's tax rates, each with its own name ("GST", "Sales tax") and percentage in hundredths
-- (825 is 8.25%). A product, a membership type and a membership a person holds each charge
-- one or none. Whether the prices hold the tax stays one setting for the gym
-- (`gyms.sales_tax_included`), as a country charges it. A rate is removed only once nothing
-- live charges it; what it was is kept on every sale and bill made with it.
CREATE TABLE "gym_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_tax_rates_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_tax_rates_name_check" CHECK (char_length("name") BETWEEN 1 AND 30),
	CONSTRAINT "gym_tax_rates_rate_check" CHECK ("rate_bp" BETWEEN 1 AND 3000)
);--> statement-breakpoint
CREATE UNIQUE INDEX "gym_tax_rates_name_uq" ON "gym_tax_rates" ("gym_id", lower("name"));--> statement-breakpoint

-- What charges a rate. Each key carries the gym, so a rate is never another gym's. Removing
-- a rate clears it from what is archived or over; the server refuses while anything live
-- charges it.
ALTER TABLE "gym_products" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_products" ADD CONSTRAINT "gym_products_tax_rate_fk" FOREIGN KEY ("gym_id", "tax_rate_id")
	REFERENCES "gym_tax_rates"("gym_id", "id") ON DELETE SET NULL ("tax_rate_id");--> statement-breakpoint
CREATE INDEX "gym_products_tax_rate_idx" ON "gym_products" ("gym_id", "tax_rate_id") WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_tax_rate_fk" FOREIGN KEY ("gym_id", "tax_rate_id")
	REFERENCES "gym_tax_rates"("gym_id", "id") ON DELETE SET NULL ("tax_rate_id");--> statement-breakpoint
CREATE INDEX "gym_membership_types_tax_rate_idx" ON "gym_membership_types" ("gym_id", "tax_rate_id") WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint
-- A membership keeps the rate it was sold with, as it keeps its price: a type changed later
-- moves nobody's bills. The rate's percentage is read when each bill is opened, so a change
-- of the law reaches every bill from then on.
ALTER TABLE "gym_held_memberships" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_tax_rate_fk" FOREIGN KEY ("gym_id", "tax_rate_id")
	REFERENCES "gym_tax_rates"("gym_id", "id") ON DELETE SET NULL ("tax_rate_id");--> statement-breakpoint
CREATE INDEX "gym_held_memberships_tax_rate_idx" ON "gym_held_memberships" ("gym_id", "tax_rate_id") WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint

-- A bill's tax, as it was opened: `amount_minor` stays what the person pays, its tax in, so
-- every reader of what is owed reads one number. A bill opened before this has none.
ALTER TABLE "gym_member_bills" ADD COLUMN "tax_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "tax_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "tax_name" text;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "tax_included" boolean;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_tax_check" CHECK (
	"tax_bp" BETWEEN 0 AND 3000
	AND ("tax_name" IS NULL) = ("tax_bp" = 0)
	AND ("tax_name" IS NULL) = ("tax_included" IS NULL)
	AND "tax_minor" >= 0 AND "tax_minor" < "amount_minor"
	AND ("tax_bp" > 0 OR "tax_minor" = 0)
	AND ("tax_name" IS NULL OR char_length("tax_name") BETWEEN 1 AND 30)
);--> statement-breakpoint

-- A sale keeps its tax's name too, for its receipt (18g).
ALTER TABLE "gym_sales" ADD COLUMN "tax_name" text;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_tax_name_check" CHECK ("tax_name" IS NULL OR char_length("tax_name") BETWEEN 1 AND 30);--> statement-breakpoint

-- A gym's one rate becomes its first named rate, "Tax", charged on the products that
-- charged it. A gym at 0 had no tax and gets no rate.
INSERT INTO "gym_tax_rates" ("gym_id", "name", "rate_bp")
SELECT "id", 'Tax', "sales_tax_bp" FROM "gyms" WHERE "sales_tax_bp" > 0;--> statement-breakpoint
UPDATE "gym_products" p SET "tax_rate_id" = r."id"
FROM "gym_tax_rates" r
WHERE r."gym_id" = p."gym_id" AND p."taxed";--> statement-breakpoint
ALTER TABLE "gym_products" DROP COLUMN "taxed";--> statement-breakpoint
ALTER TABLE "gyms" DROP CONSTRAINT "gyms_sales_tax_check";--> statement-breakpoint
ALTER TABLE "gyms" DROP COLUMN "sales_tax_bp";
