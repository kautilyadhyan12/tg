-- Numbered receipts (ROADMAP Stage 2 item 18g-i; spec Part 3 §14.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.

-- Every payment, refund and product sale is a receipt with the gym's own number: 1, 2, 3,
-- one count across the three, never used twice. `gyms.receipts_issued` is the last number
-- given; a write takes the next in the same statement that writes its row, under the gym's
-- row lock, so two at one instant are numbered one after the other. A row taken back keeps
-- its number.
ALTER TABLE "gyms" ADD COLUMN "receipts_issued" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_receipts_issued_check" CHECK ("receipts_issued" >= 0);--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD COLUMN "receipt_number" integer;--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD COLUMN "receipt_number" integer;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD COLUMN "receipt_number" integer;--> statement-breakpoint

-- What was written before this is numbered in the order it was written, gym by gym.
WITH "written" AS (
	SELECT "gym_id", 'payment' AS "kind", "id", "created_at", "seq" AS "ord" FROM "gym_member_payments"
	UNION ALL
	SELECT "gym_id", 'refund', "id", "created_at", 0 FROM "gym_member_refunds"
	UNION ALL
	SELECT "gym_id", 'sale', "id", "created_at", "seq" FROM "gym_sales"
),
"numbered" AS (
	SELECT "kind", "id", row_number() OVER (PARTITION BY "gym_id" ORDER BY "created_at", "kind", "ord", "id")::integer AS "n"
	FROM "written"
),
"payments" AS (
	UPDATE "gym_member_payments" p SET "receipt_number" = n."n"
	FROM "numbered" n WHERE n."kind" = 'payment' AND n."id" = p."id"
	RETURNING 1
),
"refunds" AS (
	UPDATE "gym_member_refunds" r SET "receipt_number" = n."n"
	FROM "numbered" n WHERE n."kind" = 'refund' AND n."id" = r."id"
	RETURNING 1
)
UPDATE "gym_sales" s SET "receipt_number" = n."n"
FROM "numbered" n WHERE n."kind" = 'sale' AND n."id" = s."id";--> statement-breakpoint

UPDATE "gyms" g SET "receipts_issued" = c."n"
FROM (
	SELECT "gym_id", count(*)::integer AS "n" FROM (
		SELECT "gym_id" FROM "gym_member_payments"
		UNION ALL SELECT "gym_id" FROM "gym_member_refunds"
		UNION ALL SELECT "gym_id" FROM "gym_sales"
	) "all_rows" GROUP BY "gym_id"
) c
WHERE c."gym_id" = g."id";--> statement-breakpoint

ALTER TABLE "gym_member_payments" ALTER COLUMN "receipt_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ALTER COLUMN "receipt_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_sales" ALTER COLUMN "receipt_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_receipt_check" CHECK ("receipt_number" >= 1);--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_receipt_check" CHECK ("receipt_number" >= 1);--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_receipt_check" CHECK ("receipt_number" >= 1);--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_receipt_uq" UNIQUE ("gym_id", "receipt_number");--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_receipt_uq" UNIQUE ("gym_id", "receipt_number");--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_receipt_uq" UNIQUE ("gym_id", "receipt_number");--> statement-breakpoint

-- A sale made to somebody on the gym's list keeps that it was, for its receipt: a record
-- deleted for good lets go of the sale (`entry_id` to null, 0102), and the receipt then says
-- a deleted member's, never a walk-in's. A sale whose record went before this is a walk-in's.
ALTER TABLE "gym_sales" ADD COLUMN "for_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "gym_sales" SET "for_member" = true WHERE "entry_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_for_member_check" CHECK ("entry_id" IS NULL OR "for_member");
