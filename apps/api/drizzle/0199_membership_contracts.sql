-- A contract on a repeating membership (ROADMAP Stage 2 item 18v-i; Kd, 2026-11-03,
-- `rulings/2026-11-03-18v-i.md`). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit. Renumbered from 0198 when the phone passes' `0198_push_claims` merged first.
--
-- A line of the price list may hold a contract: so many payments (`contract_periods`), then it
-- goes on renewing or ends (`contract_then`). A membership given from it copies both, as it copies
-- the price, so a later change to the line moves nobody already on it. "End when the contract
-- ends" sets a membership's own `contract_then` to `ends`. A member let out of a contract early
-- keeps the reason staff gave (`contract_release`).
ALTER TABLE "gym_membership_types" ADD COLUMN "contract_periods" integer;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD COLUMN "contract_then" text;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_contract_check" CHECK (("contract_periods" IS NULL) = ("contract_then" IS NULL) AND ("contract_periods" IS NULL OR ("kind" = 'recurring' AND "price_minor" > 0 AND "contract_periods" BETWEEN 1 AND 156 AND "contract_then" IN ('renews','ends'))));--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "contract_periods" integer;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "contract_then" text;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "contract_release" text;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_contract_check" CHECK (("contract_periods" IS NULL) = ("contract_then" IS NULL) AND ("contract_periods" IS NULL OR ("kind" = 'recurring' AND "contract_periods" BETWEEN 1 AND 156 AND "contract_then" IN ('renews','ends'))));--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_contract_release_check" CHECK ("contract_release" IS NULL OR ("contract_release" IN ('moved','medical','death','other') AND "contract_periods" IS NOT NULL AND ("status" = 'cancelled' OR NOT "renews")));
