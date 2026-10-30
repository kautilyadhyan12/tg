-- Square Point of Sale taken out (ROADMAP Stage 2 item 18d-iii-b-v; Kd, 2026-10-30, rulings/2026-10-30-18d-iii-b-v.md): the
-- Square Terminal and the card on file stay; payments taken in Square's own app are recorded by hand, as Card at the desk.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit. Every gym that used it was a
-- test gym (nothing was in front of a real person before launch).
--
-- A payment recorded from Square Point of Sale stays paid on its bill, as Card at the desk, without Square's payment id: the
-- app no longer reads those payments. Then the method goes from the payment checks.
UPDATE "gym_member_payments" SET "method" = 'card_at_desk', "provider" = NULL, "provider_payment_id" = NULL WHERE "method" = 'square_app';
--> statement-breakpoint
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_method_check";
--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','link','company','terminal'));
--> statement-breakpoint
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_provider_check";
--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_provider_check" CHECK (("method" IN ('company','terminal')) = ("provider" IS NOT NULL) AND ("provider" IS NULL) = ("provider_payment_id" IS NULL) AND ("provider" IS NULL OR (char_length("provider") BETWEEN 1 AND 40 AND char_length("provider_payment_id") BETWEEN 1 AND 200)));
--> statement-breakpoint
-- What took payments in and matched them (0164, 0165, 0173, 0174), Members in Square's checks (0166) and the old ids of
-- Square's merges (0167), all read only by what was taken out.
DROP TABLE "gym_square_app_payments";
--> statement-breakpoint
DROP TABLE "gym_square_payment_sweeps";
--> statement-breakpoint
DROP TABLE "gym_square_member_plan";
--> statement-breakpoint
DROP TABLE "gym_square_member_candidates";
--> statement-breakpoint
DROP TABLE "gym_square_member_runs";
--> statement-breakpoint
DROP TABLE "gym_square_unlinked_customers";
--> statement-breakpoint
DROP TABLE "gym_square_old_customers";
--> statement-breakpoint
DROP TABLE "gym_square_customer_merges";
--> statement-breakpoint
-- A customer Match linked to a record from a payment (0174) may be somebody else's (Pat's, paying for her son Sam): the link
-- goes, and the next card saved for the person makes them a customer of their own. A card already saved on it stays.
DELETE FROM "gym_square_customers" WHERE "matched_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP CONSTRAINT "gym_square_customers_copied_check";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP CONSTRAINT "gym_square_customers_refused_check";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "matched_at";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "copied_name";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "copied_email";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "copied_phone";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "copied_at";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "copy_refused_digest";
--> statement-breakpoint
ALTER TABLE "gym_square_customers" DROP COLUMN "copy_refused_at";
