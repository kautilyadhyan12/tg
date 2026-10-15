-- Payments stay when a record is deleted for good (ROADMAP Stage 2 item 18m;
-- rulings/2026-10-15-18g-i.md). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- A membership that has a payment on it (one taken back too: it has a receipt number) lets
-- go of its record before the record is deleted, so its bills, payments, refunds and
-- receipts stay in the gym's takings and reports, with no name. It is over by then, and
-- nothing reads it as anybody's membership again. `memberList/repo.ts`, `deleteEntry`.
-- The key to the record still cascades: a membership with no payment goes with its record,
-- and a gym's whole list deleted takes everything, as before.
ALTER TABLE "gym_held_memberships" ALTER COLUMN "entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "record_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_record_deleted_check" CHECK (
	("entry_id" IS NULL) = ("record_deleted_at" IS NOT NULL)
	AND ("entry_id" IS NOT NULL OR "status" IN ('ended','cancelled'))
);
