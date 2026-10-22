-- A joining fee on a membership type, charged on the first bill of a membership given from
-- it (ROADMAP Stage 2 item 18t; Kd, `rulings/2026-10-22-18t.md`). Forward-only. Hand-written,
-- as `0016` onwards are; its journal entry is part of this commit.
--
-- The type's fee, in minor units of its money: 0 is none. Only a repeating or a paid-once
-- type with a price has one; a pack, a trial and a free type open no first bill to carry it.
ALTER TABLE "gym_membership_types" ADD COLUMN "joining_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_joining_fee_check" CHECK (
  "joining_fee_minor" BETWEEN 0 AND 99999999
  AND ("joining_fee_minor" = 0 OR ("kind" IN ('recurring','one_time') AND "price_minor" > 0))
);--> statement-breakpoint
-- The fee inside a bill's `amount_minor`, before any tax added on top: on the bill of a
-- period opened when the membership was given, never on a fee's bill.
ALTER TABLE "gym_member_bills" ADD COLUMN "joining_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_joining_fee_check" CHECK (
  "joining_fee_minor" >= 0 AND "joining_fee_minor" <= "amount_minor"
  AND ("joining_fee_minor" = 0 OR "period_index" IS NOT NULL)
);
