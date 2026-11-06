-- Sell in the app (ROADMAP Stage 2 item 18k-i; Kd, 2026-11-06, `rulings/2026-11-06-18k-i.md`). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A line of the price list members may buy in the app: a repeating or paid-once membership, or a pack (a day pass
-- is a pack), with a price. Never a trial, never a product. A constant default adds the column without rewriting
-- the table; every line starts off.
ALTER TABLE "gym_membership_types" ADD COLUMN "sold_in_app" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_sold_in_app_check" CHECK (NOT "sold_in_app" OR ("kind" IN ('recurring','one_time','pack') AND "price_minor" > 0));
