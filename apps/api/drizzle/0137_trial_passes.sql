-- The free trial's two extra passes (ROADMAP Stage 3 item 2h). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- 1. One person for free-trial counting learns Fastmail's subdomain addressing: mail to
--    `anything@name.fastmail.com` reaches `name@fastmail.com` with no setup (Fastmail's help,
--    "Plus addressing and subdomain addressing"). `trialPersonKey` in packages/shared is the
--    same rule; apps/api/test/orgs.trialPerson.test.ts runs both over the same cases. The
--    stored column is worked out again for the addresses the new rule reads differently.
CREATE OR REPLACE FUNCTION "trial_person_key"("address" text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$
  SELECT CASE
    WHEN position('@' in a) = 0 THEN a
    WHEN d IN ('gmail.com', 'googlemail.com') THEN replace(l, '.', '') || '@gmail.com'
    WHEN d ~ '^[a-z0-9-]+\.fastmail\.com$' THEN split_part(d, '.', 1) || '@fastmail.com'
    ELSE l || '@' || d
  END
  FROM (
    SELECT a,
           regexp_replace(regexp_replace(a, '^.*@', ''), '\.+$', '') AS d,
           regexp_replace(regexp_replace(a, '@[^@]*$', ''), '^([^+]+)\+.*$', '\1') AS l
    FROM (SELECT lower(regexp_replace("address", '^\s+|\s+$', '', 'g')) AS a) AS s0
  ) AS s1
$$;--> statement-breakpoint
UPDATE "users" SET "email" = "email" WHERE "email" ILIKE '%.fastmail.com%';--> statement-breakpoint
-- 2. Create a gym is safe to send twice: the form sends a key made when it opens, and a second
--    press with the same key answers the gym the first one made.
ALTER TABLE "gyms" ADD COLUMN "create_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "gyms_owner_create_key_uq" ON "gyms" ("owner_user_id", "create_key")
  WHERE "create_key" IS NOT NULL;--> statement-breakpoint
-- 3. The count of an owner's unpaid gyms on each Create (2g) reads the owner's gyms only.
CREATE INDEX "gyms_owner_user_id_idx" ON "gyms" ("owner_user_id");
