-- Void a payment, a refund or a sale, as gym software does (ROADMAP Stage 2 item 18o;
-- rulings/2026-10-15-18o.md). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- Staff pick why they voided it, from a list, never typed. A row voided before this has no
-- reason; a reason is only ever on a voided row.
ALTER TABLE "gym_member_payments" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_void_reason_check" CHECK (
	"void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','wrong_person','other'))
);--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_void_reason_check" CHECK (
	"void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','other'))
);--> statement-breakpoint
ALTER TABLE "gym_sales" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_void_reason_check" CHECK (
	"void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_item','returned','other'))
);
