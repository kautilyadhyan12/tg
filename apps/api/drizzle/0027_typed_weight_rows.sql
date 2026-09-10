-- BODY WEIGHT HAS ONE SOURCE (Kd ruling 2026-09-10; ROADMAP Stage 1 item 4a-i).
-- Data-only, forward-only, idempotent. No schema change.
--
-- Hand-written, for the recorded reason `0016`–`0026` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- THE RULE THIS SERVES. From this release `users.weight_kg` is only a cache of
-- the newest `body_measurements` row that says something about weight: a row
-- with a `weight_kg`, or a row with source `self_reported` (a weight the
-- person TYPED on a form — which may carry no weight at all, the record of a
-- deliberate clear). Every write to the history recomputes the cache
-- (nutrition/repo.ts refreshWeight), so a deleted mis-entry falls back to the
-- weight before it and never to a blank.
--
-- WHY A BACKFILL. Until now a typed weight was written straight to the column
-- with NO row behind it (the pre-4a-i PATCH /v1/users/me; the users half of the
-- Mongo import), so today every such weight would vanish on the person's first
-- ordinary correction — log a weigh-in, delete it, and the cache recomputes
-- from a history that never held their number: a blank plan and blank rings.
-- The two statements below make the rule true for every row that already
-- exists, so the live code needs no special case for "a weight with nothing
-- under it" (a COALESCE onto the column, which kept the very mis-entry a
-- person had just deleted).
--
-- STATEMENT 1: a user whose column holds a weight that the newest
-- weight-bearing row does not carry (no such row, or a different number: the
-- column was written directly after it) gets ONE typed row with that number,
-- dated so that it is the newest of everything they have — now(), or one
-- second after their newest entry if that is ahead of the clock. Nobody's
-- number moves; it gains the row that will let it survive.
--
-- STATEMENT 2: a user whose column is EMPTY while their newest
-- weight-bearing row carries a number cleared it on purpose under the old
-- code (the only way that state arises: the import wrote the newest row's
-- number, and only PATCH weightKg: null could empty it after). The clear
-- becomes the row it now is — typed, no weight, newest — so the next edit to
-- their history cannot bring the cleared number back.
--
-- NO status filter, on purpose. A soft-deleted account keeps its weight and
-- its history for the whole undo window (users/repo.ts softDeleteUser nulls
-- neither; only the Day-14 purge in privacy/repo.ts does), and restoreUser
-- brings it back exactly as it was — so it needs the same row as everyone
-- else, or the restored person is the one whose number vanishes on their
-- first correction. A purged account has a NULL column and no rows, so it
-- matches neither statement. Re-running either statement finds nothing to
-- do: after the first run the newest weight-bearing row equals the column
-- for everyone.
INSERT INTO "body_measurements" ("user_id", "measured_at", "weight_kg", "metrics", "source")
SELECT u."id",
       GREATEST(now(), (SELECT max("measured_at") FROM "body_measurements" WHERE "user_id" = u."id") + interval '1 second'),
       u."weight_kg", '{}'::jsonb, 'self_reported'
FROM "users" u
LEFT JOIN LATERAL (
  SELECT "weight_kg" FROM "body_measurements"
  WHERE "user_id" = u."id" AND ("weight_kg" IS NOT NULL OR "source" = 'self_reported')
  ORDER BY "measured_at" DESC, "id" DESC LIMIT 1) newest ON true
WHERE u."weight_kg" IS NOT NULL
  AND (newest."weight_kg" IS NULL OR newest."weight_kg" <> u."weight_kg");--> statement-breakpoint
INSERT INTO "body_measurements" ("user_id", "measured_at", "weight_kg", "metrics", "source")
SELECT u."id",
       GREATEST(now(), (SELECT max("measured_at") FROM "body_measurements" WHERE "user_id" = u."id") + interval '1 second'),
       NULL, '{}'::jsonb, 'self_reported'
FROM "users" u
JOIN LATERAL (
  SELECT "weight_kg" FROM "body_measurements"
  WHERE "user_id" = u."id" AND ("weight_kg" IS NOT NULL OR "source" = 'self_reported')
  ORDER BY "measured_at" DESC, "id" DESC LIMIT 1) newest ON true
WHERE u."weight_kg" IS NULL
  AND newest."weight_kg" IS NOT NULL;
