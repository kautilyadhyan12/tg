-- One person for free-trial counting, however the address is spelled (ROADMAP Stage 3
-- item 2b; RULINGS 2026-09-08, layer 1). Forward-only. Hand-written, as `0016` onwards
-- are; its journal entry is part of this commit.
--
-- The rule is `trialPersonKey` in packages/shared: Gmail without dots and googlemail.com
-- read as gmail.com, a `+tag` dropped on every domain. This function is its copy for the
-- database, and apps/api/test/trialPerson.db.test.ts runs both over the same cases.
-- The column is worked out by the database, so every way a user is written gets it, and
-- the Day-14 purge's `email = NULL` clears it with the address.
CREATE FUNCTION "trial_person_key"("address" text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$
  SELECT CASE
    WHEN position('@' in a) = 0 THEN a
    WHEN d IN ('gmail.com', 'googlemail.com') THEN replace(l, '.', '') || '@gmail.com'
    ELSE l || '@' || d
  END
  FROM (
    SELECT a,
           regexp_replace(regexp_replace(a, '^.*@', ''), '\.+$', '') AS d,
           regexp_replace(regexp_replace(a, '@[^@]*$', ''), '^([^+]+)\+.*$', '\1') AS l
    FROM (SELECT lower(regexp_replace("address", '^\s+|\s+$', '', 'g')) AS a) AS s0
  ) AS s1
$$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_person_key" text
  GENERATED ALWAYS AS ("trial_person_key"("email"::text)) STORED;--> statement-breakpoint
CREATE INDEX "users_trial_person_key_idx" ON "users" ("trial_person_key")
  WHERE "trial_person_key" IS NOT NULL;
