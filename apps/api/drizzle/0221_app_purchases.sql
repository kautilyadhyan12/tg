-- Buy in the app (ROADMAP Stage 2 item 18k-iii-a; Kd, 2026-11-07; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member buys a pack or a membership paid once on Square's own payment page. The page is a row of
-- `gym_app_payments` like a bill's or a fee's, for a line of the price list (`membership_type_id`) in place of a
-- membership: nothing is given until Square says it is paid, and then the membership is given on the record, its first
-- bill paid in the app, and its agreement signed with what the member read (`bought`), in one transaction.
-- `held_membership_id` is the membership given, once it is. `bought` is what the screen showed, kept as the server
-- worked it out: the price, the first payment, the terms, the gifts, and the signature's name and details until they
-- are written to `gym_agreement_signatures`. A purchase Square took money for that could not be given is kept until
-- staff mark it checked (`cleared_at`).
ALTER TABLE "gym_app_payments" ADD COLUMN "membership_type_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "bought" jsonb;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "cleared_by" uuid;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ALTER COLUMN "held_membership_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_payments" DROP CONSTRAINT "gym_app_payments_bill_check";--> statement-breakpoint
-- A bill's period or a fee of a membership; or a line bought, whose membership exists once it is paid.
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_bill_check" CHECK (
	CASE WHEN "membership_type_id" IS NULL
		THEN num_nonnulls("period_index", "fee_bill_id") = 1 AND "held_membership_id" IS NOT NULL AND "bought" IS NULL AND "cleared_at" IS NULL
		ELSE "period_index" IS NULL AND "fee_bill_id" IS NULL AND "bought" IS NOT NULL
			AND (("outcome" IS NOT DISTINCT FROM 'paid') = ("held_membership_id" IS NOT NULL))
			AND ("cleared_at" IS NULL OR "outcome" IN ('not_recorded','gone','no_answer'))
	END);--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_cleared_check" CHECK ("cleared_by" IS NULL OR "cleared_at" IS NOT NULL);--> statement-breakpoint
-- One purchase page open for a record at a time.
CREATE UNIQUE INDEX "gym_app_payments_purchase_uq" ON "gym_app_payments" USING btree ("gym_id","entry_id") WHERE "state" = 'open' AND "membership_type_id" IS NOT NULL;--> statement-breakpoint
-- The price list holds a line while a member is buying it; the person's page reads the purchases needing a check.
CREATE INDEX "gym_app_payments_type_open_idx" ON "gym_app_payments" USING btree ("gym_id","membership_type_id") WHERE "state" = 'open' AND "membership_type_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_app_payments_purchase_check_idx" ON "gym_app_payments" USING btree ("gym_id","entry_id") WHERE "membership_type_id" IS NOT NULL AND "outcome" IN ('not_recorded','gone','no_answer') AND "cleared_at" IS NULL;--> statement-breakpoint
-- An agreement signed in the app as the member bought it, with no staff screen.
ALTER TABLE "gym_agreement_signatures" DROP CONSTRAINT "gym_agreement_signatures_via_check";--> statement-breakpoint
ALTER TABLE "gym_agreement_signatures" ADD CONSTRAINT "gym_agreement_signatures_via_check" CHECK ("signed_via" IN ('desk', 'link', 'app'));
