-- Three decimals, and several taxes on a product (ROADMAP Stage 2 item 18b-v-a; Kd, 2026-11-05,
-- `rulings/2026-11-05-18b-v-a.md`). Forward-only. Hand-written, as `0016` onwards are; its journal entry
-- is part of this commit.
--
-- A tax rate is kept in thousandths of a percent ("pcm", per cent mille), no longer hundredths: Quebec's QST
-- is 9.975%, New York City's sales tax 8.875%. Every rate kept, and the rate every sale and bill was made
-- with, is the same percentage times ten: 825 (8.25%) is 8250. The amounts of tax already worked out are
-- whole minor units and do not move.
ALTER TABLE "gym_tax_rates" DROP CONSTRAINT "gym_tax_rates_rate_check";--> statement-breakpoint
ALTER TABLE "gym_tax_rates" RENAME COLUMN "rate_bp" TO "rate_pcm";--> statement-breakpoint
UPDATE "gym_tax_rates" SET "rate_pcm" = "rate_pcm" * 10;--> statement-breakpoint
ALTER TABLE "gym_tax_rates" ADD CONSTRAINT "gym_tax_rates_rate_check" CHECK ("rate_pcm" BETWEEN 1 AND 30000);--> statement-breakpoint
--
ALTER TABLE "gym_member_bills" DROP CONSTRAINT "gym_member_bills_tax_check";--> statement-breakpoint
ALTER TABLE "gym_member_bills" RENAME COLUMN "tax_bp" TO "tax_pcm";--> statement-breakpoint
UPDATE "gym_member_bills" SET "tax_pcm" = "tax_pcm" * 10 WHERE "tax_pcm" > 0;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_tax_check" CHECK (
	"tax_pcm" BETWEEN 0 AND 30000
	AND ("tax_name" IS NULL) = ("tax_pcm" = 0)
	AND ("tax_name" IS NULL) = ("tax_included" IS NULL)
	AND "tax_minor" >= 0 AND "tax_minor" < "amount_minor"
	AND ("tax_pcm" > 0 OR "tax_minor" = 0)
	AND ("tax_name" IS NULL OR char_length("tax_name") BETWEEN 1 AND 30)
);--> statement-breakpoint
--
-- A sale line keeps each tax it was sold with, by its name and rate then and how much (`taxes`, in the order
-- the product charged them): a receipt names each one, as Revenu Québec's "Showing the Taxes" asks of GST and
-- QST. `tax_pcm` and `tax_minor` stay the line's whole tax, added up; `tax_name` is the tax's name where there
-- was one tax, and null where there were several. A line sold before keeps its one tax in `taxes` too.
ALTER TABLE "gym_sales" DROP CONSTRAINT "gym_sales_tax_check";--> statement-breakpoint
ALTER TABLE "gym_sales" RENAME COLUMN "tax_bp" TO "tax_pcm";--> statement-breakpoint
ALTER TABLE "gym_sales" ADD COLUMN "taxes" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
UPDATE "gym_sales"
SET "tax_pcm" = "tax_pcm" * 10,
    "taxes" = jsonb_build_array(jsonb_build_object('name', "tax_name", 'pcm', "tax_pcm" * 10, 'minor', "tax_minor"))
WHERE "tax_pcm" > 0;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_tax_check" CHECK (
	"tax_pcm" BETWEEN 0 AND 30000 AND ("tax_pcm" > 0 OR "tax_minor" = 0)
	AND jsonb_typeof("taxes") = 'array' AND jsonb_array_length("taxes") <= 10
	AND ("tax_pcm" > 0) = (jsonb_array_length("taxes") > 0)
);--> statement-breakpoint
--
-- A basket waiting on the Terminal (0153) keeps its lines as priced: each line's one `rate` becomes its list of
-- `taxes`, so a payment Square takes after this change records the sale it was priced as.
UPDATE "gym_terminal_payments" p
SET "sale" = jsonb_set(p."sale", '{lines}', (
	SELECT jsonb_agg(
		CASE WHEN jsonb_typeof(l -> 'rate') = 'object' AND (l -> 'rate' ->> 'bp')::int > 0
			THEN (l - 'rate') || jsonb_build_object('taxes', jsonb_build_array(jsonb_build_object(
				'name', l -> 'rate' -> 'name', 'pcm', (l -> 'rate' ->> 'bp')::int * 10, 'minor', l -> 'taxMinor')))
			ELSE (l - 'rate') || jsonb_build_object('taxes', '[]'::jsonb)
		END ORDER BY o)
	FROM jsonb_array_elements(p."sale" -> 'lines') WITH ORDINALITY AS x(l, o)))
WHERE p."sale" IS NOT NULL AND jsonb_typeof(p."sale" -> 'lines') = 'array' AND jsonb_array_length(p."sale" -> 'lines') > 0;--> statement-breakpoint
--
-- A product charges as many of the gym's rates as it needs, in the order they were picked (`position`), each
-- once; together at most 30%, which the server checks under the gym's lock, as it checks a rate is the gym's.
-- A product's one rate is its first. A rate removed, or a product, takes its rows with it: a rate in use on a
-- product on sale is never removed (`taxRepo.removeRate`), so only an archived product loses one, as before.
CREATE TABLE "gym_product_tax_rates" (
	"gym_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "gym_product_tax_rates_pk" PRIMARY KEY ("product_id", "tax_rate_id"),
	CONSTRAINT "gym_product_tax_rates_product_fk" FOREIGN KEY ("gym_id", "product_id") REFERENCES "gym_products" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_product_tax_rates_rate_fk" FOREIGN KEY ("gym_id", "tax_rate_id") REFERENCES "gym_tax_rates" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_product_tax_rates_position_check" CHECK ("position" >= 1)
);--> statement-breakpoint
CREATE INDEX "gym_product_tax_rates_rate_idx" ON "gym_product_tax_rates" ("gym_id", "tax_rate_id");--> statement-breakpoint
INSERT INTO "gym_product_tax_rates" ("gym_id", "product_id", "tax_rate_id", "position")
SELECT "gym_id", "id", "tax_rate_id", 1 FROM "gym_products" WHERE "tax_rate_id" IS NOT NULL;--> statement-breakpoint
DROP INDEX "gym_products_tax_rate_idx";--> statement-breakpoint
ALTER TABLE "gym_products" DROP CONSTRAINT "gym_products_tax_rate_fk";--> statement-breakpoint
ALTER TABLE "gym_products" DROP COLUMN "tax_rate_id";
