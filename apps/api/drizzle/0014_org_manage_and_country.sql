-- A GYM CAN FIX ITS OWN DETAILS (server half). Expand-only, forward-only.
-- Reviewed as SQL by Kd before anything else was written (T5, R4.4).
--
-- Three statements, two subjects: the seventh privilege that gates the new
-- `PATCH /v1/orgs/:gymId`, and the column that finally remembers which country
-- a gym is in.

-- 1 · A SEVENTH PRIVILEGE: `org.manage` — "edit gym details".
--
--     KD RULING 2026-08-26, given at the plan gate in response to the cited
--     option: a NEW privilege, owner-only BY DEFAULT. The alternative offered
--     was reusing `staff.manage` (no migration) and it was recommended AGAINST
--     on :13803's precedent — *"`codes.manage` is a NEW privilege and
--     deliberately NOT `codes.invite`"*: two rows that mean different things get
--     different privileges, or one tick silently widens the other's power.
--
--     "Owner-only by DEFAULT" and not owner-only for ever: it goes into
--     `ROLE_PRIVILEGES.owner` and into neither `OWNER_ONLY_PRIVILEGES` nor
--     `LAST_OWNER_REQUIRED_PRIVILEGES`, so an owner may hand it to a manager
--     later (:11429 rule 3 — ticks may widen, not only narrow) and cannot lock
--     themselves out, because they always hold `staff.manage` and can tick it
--     back.
--
--     DROP-then-ADD rather than an ALTER: Postgres has no "widen a CHECK" verb.
--     The window between the two statements is inside one migration transaction.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage']::text[]);--> statement-breakpoint

-- 2 · EVERY EXISTING OWNER GETS THE NEW PRIVILEGE.
--
--     WHY THIS IS NOT THE THING KD RULED AGAINST ON 2026-08-22 (DECISIONS
--     :15381). That ruling makes the stored set a SNAPSHOT: editing what a ROLE
--     may do must never reach back and change what a named person may do. It
--     protects a decision somebody MADE. Nobody has ever made a decision about
--     this privilege — it does not exist until the statement above runs, so no
--     owner has been ticked down from it and none can be widened by surprise.
--
--     Without this line the card ships DEAD: `privilegesFor` prefers the stored
--     set over the role template, so every owner of every existing gym would be
--     403'd on their own gym, and the "change everyone on this role too?" button
--     that would re-grant it belongs to the custom-role-names card, which is not
--     built. Same reasoning and the same shape as `0013`'s own backfill, and the
--     same R4.4 departure named rather than slipped past: the backfill sits
--     inside the migration because `gym_staff` is 2 rows on the dev database and
--     0 on a fresh one (measured 2026-08-22), so there is no lock to spread out,
--     while a separate job somebody has to remember to run is how staff rows end
--     up wrong.
--
--     Idempotent by its own WHERE. Rows with a NULL set are deliberately
--     untouched — they are the deploy window, they already read the role's
--     defaults, and those defaults now include `org.manage`.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'org.manage')
WHERE "role" = 'owner'
  AND "privileges" IS NOT NULL
  AND NOT ("privileges" @> ARRAY['org.manage']::text[]);--> statement-breakpoint

-- 3 · REMEMBER WHICH COUNTRY A GYM IS IN.
--
--     The wizard has asked for it since 2026-08-18 and the server has THROWN IT
--     AWAY every time: `createOrg` maps it to a currency and never stores it
--     (grep-verified — `country` appears in this module only inside that
--     mapping, and `gyms` has no such column). So "change your country" would be
--     a box that can be written and never read, and the console would have
--     nothing to prefill.
--
--     DELIBERATELY NOT BACKFILLED. USD/CAD/GBP/INR each point back to exactly
--     one row of `COUNTRY_CURRENCY`, so an inverse fill looks exact — but `INR`
--     is also this column's DEFAULT, i.e. the value a row carries when nobody
--     said anything, so the fill would stamp 'IN' onto gyms that never chose it.
--     EUR is ambiguous 20 ways regardless. NULL means "we never asked", which is
--     the only claim true of every existing row, and Kd's currency ruling
--     (:10010/:10099) refuses exactly this class of inference about where a gym
--     is — a fallback there is how a Canadian gym gets quoted in rupees.
--     `currency_display` is unchanged and stays the field that decides money.
--
--     SHAPE ONLY in the CHECK — two capitals, ISO 3166-1 alpha-2. WHETHER we are
--     open in a country is `supportedCountrySchema`'s answer and that list grows
--     as Kd opens new markets; naming its 24 members here would mean a migration
--     every time one is added, and a stale copy of a list in DDL is a second
--     answer to "where do we operate".
ALTER TABLE "gyms" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_country_check" CHECK ("gyms"."country" IS NULL OR "gyms"."country" ~ '^[A-Z]{2}$');
