-- ORGANISATION TYPES: gym · studio · personal trainer (Kd ruling 2026-09-07).
-- Expand-only, forward-only. Hand-written for the reason `0016`–`0023` record:
-- `drizzle/meta/` stops at `0012_snapshot.json`, so `drizzle-kit generate`
-- re-emits everything since. Its journal entry is part of this commit.
--
-- `clinic` STAYS in the CHECK. Clinics are out of the product at the DOOR
-- (`createOrgTypeSchema` refuses one), but a row that already exists must keep
-- reading back, and rewriting its type would be inventing an answer nobody
-- gave. No data is touched.
--
-- DROP-then-ADD rather than an ALTER: Postgres has no "widen a CHECK" verb. The
-- window between the two statements is inside one migration transaction.
ALTER TABLE "gyms" DROP CONSTRAINT "gyms_org_type_check";--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_org_type_check" CHECK ("gyms"."org_type" IN ('gym','studio','personal_trainer','clinic'));
