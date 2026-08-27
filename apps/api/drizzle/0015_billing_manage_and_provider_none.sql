-- A GYM CAN START ITS OWN 30-DAY TRIAL (server half). Expand-only, forward-only.
-- Reviewed as SQL by Kd before anything else was written (T5, R4.4).
--
-- Three statements, two subjects: the eighth privilege that gates the new
-- `POST /v1/orgs/:gymId/trial`, and the `provider` value a card-less trial has
-- to be written under.

-- 1 · AN EIGHTH PRIVILEGE: `billing.manage` — "start, change or end the gym's
--     subscription".
--
--     §2.2 HAS THIS ROW ALREADY and it is the strictest one in the matrix:
--     *"Billing (view, upgrade, payment method, cancel) | ✔ | — | —"*
--     (`03-part3-org-console.md:99`) — the owner, and nobody else. So unlike
--     `org.manage` this is NOT an addition with no governing §; it is the
--     matrix's own row finally getting a tick.
--
--     WHY NOT REUSE `org.manage`. It means "edit gym details" (`0014`), and
--     starting a subscription is not editing a detail — it starts a clock, caps
--     the roster and freezes the gym's billing country. :13803's precedent is
--     directly on point: *"`codes.manage` is a NEW privilege and deliberately NOT
--     `codes.invite`"* — two rows that mean different things get different
--     privileges, or one tick silently widens the other's power.
--
--     WHY NOT GATE THE ROUTE ON `role = 'owner'` INSTEAD, which needs no
--     migration at all: :11429 built a permission SEAM whose whole point is that
--     no route checks a role NAME, and it says so in as many words — *"a new
--     route checking a role NAME re-opens it"*. :15534's C/H-1 is what that costs
--     in practice. A role-gated route here would be the eighth route in this
--     module and the only one out of step.
--
--     "Owner-only by DEFAULT", like `org.manage`: it goes into
--     `ROLE_PRIVILEGES.owner` and NOT into `OWNER_ONLY_PRIVILEGES`, so an owner
--     who wants their manager to handle the invoice can tick it across
--     (:11429 rule 3 — ticks may widen, not only narrow).
--
--     IT DOES GO INTO `LAST_OWNER_REQUIRED_PRIVILEGES`, and that is this
--     statement closing an OWED line rather than opening one. :11429 rule 2 names
--     TWO lockout doors — *"ticking away the last owner's billing/staff-management
--     is the same lockout by another door"* — and the guard has only ever covered
--     `staff.manage`, because billing had no tick to cover. The difference from
--     `org.manage` is real: an owner ticked down from `org.manage` still holds
--     `staff.manage` and can tick it straight back, but a gym whose last owner
--     cannot reach billing cannot pay, and nothing inside the gym repairs that.
--
--     DROP-then-ADD rather than an ALTER: Postgres has no "widen a CHECK" verb.
--     The window between the two statements is inside one migration transaction.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage']::text[]);--> statement-breakpoint

-- 2 · EVERY EXISTING OWNER GETS THE NEW PRIVILEGE.
--
--     Identical in shape and in reasoning to `0013`'s and `0014`'s backfills, and
--     the same R4.4 departure named rather than slipped past: the backfill sits
--     inside the migration because `gym_staff` is small (measured on the dev
--     database at `0014` time: 2 rows) so there is no lock to spread out, while a
--     separate job somebody has to remember to run is how staff rows end up
--     wrong.
--
--     NOT the thing Kd ruled against at :15381. That ruling makes the stored set
--     a SNAPSHOT so that editing a ROLE never reaches back and changes what a
--     named person may do — it protects a decision somebody MADE. Nobody has ever
--     made a decision about this privilege: it does not exist until the statement
--     above runs, so no owner has been ticked down from it.
--
--     Without this line the card ships DEAD. `privilegesFor` prefers the stored
--     set over the role template, so every owner of every existing gym would be
--     403'd on their own trial button, and the "change everyone on this role too?"
--     control that would re-grant it belongs to the unbuilt custom-role-names
--     card.
--
--     Idempotent by its own WHERE. Rows with a NULL set are deliberately
--     untouched — they are the deploy window, they already read the role's
--     defaults, and those defaults now include `billing.manage`.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'billing.manage')
WHERE "role" = 'owner'
  AND "privileges" IS NOT NULL
  AND NOT ("privileges" @> ARRAY['billing.manage']::text[]);--> statement-breakpoint

-- 3 · A SUBSCRIPTION MAY BE WRITTEN WITH NO PAYMENT PROVIDER.
--
--     `0001_init` shipped `provider IN ('razorpay','stripe','revenuecat','pilot')`
--     and there is no value in it meaning "nobody is charging this gym". A
--     card-less trial has no provider by definition — that is what card-less
--     means — so today the trial cannot be written at all without lying about
--     which company holds the mandate.
--
--     THE VALUE IS THE SPEC'S OWN AND IS COPIED VERBATIM, NOT INVENTED (R0.2).
--     Part 5 §0 addendum A carries this exact ALTER for migration `0002_billing`,
--     with the list and the comment:
--         provider IN ('none','pilot','razorpay','stripe','revenuecat')
--         -- 'none' = card-less self-serve trial (§6.1); 'pilot' = hand-sold
--         --    extended trial (§6.2)
--
--     ONLY THIS ONE LINE OF THAT ADDENDUM IS TAKEN (R1.1). The rest of it —
--     `pending_plan_id`, `plan_change_at`, `invoices.tax_minor`, `invoice_no`,
--     `billing_profiles`, `invoice_counters`, `pilot_codes` — belongs to the
--     billing card that needs them, and pulling them forward would put seven
--     unused objects into the schema under a card that reads none of them.
--
--     No data change: nothing in the product has ever inserted into
--     `subscriptions` (grep-verified again this session; the 208 rows on the dev
--     branch are test fixtures, the newest from 2026-08-19). The constraint only
--     widens, so every existing row still satisfies it.
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_provider_check";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_check" CHECK ("subscriptions"."provider" IN ('none','pilot','razorpay','stripe','revenuecat'));
