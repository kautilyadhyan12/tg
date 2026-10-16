-- FIVE KINDS OF BUSINESS: gym · boutique studio · CrossFit box · yoga studio · Pilates
-- studio (Kd, 2026-10-16; ROADMAP 5f). Expand-only, forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit.
--
-- `studio` is the boutique studio, as it always was. `personal_trainer` and `clinic` stay in
-- the CHECK: both are closed at the door (`createOrgTypeSchema` refuses them), and a row that
-- already exists keeps reading back. No data is touched.
--
-- DROP-then-ADD, as `0024` did: Postgres has no "widen a CHECK" verb, and the two statements
-- run in one migration transaction.
ALTER TABLE "gyms" DROP CONSTRAINT "gyms_org_type_check";--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_org_type_check" CHECK ("gyms"."org_type" IN ('gym','studio','crossfit_box','yoga_studio','pilates_studio','personal_trainer','clinic'));
