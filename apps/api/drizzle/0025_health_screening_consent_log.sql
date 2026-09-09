-- HEALTH SCREENING, SAFE MODE AND THE CONSENT LOG (Kd rulings 2026-09-07 and
-- 2026-09-09; ROADMAP Stage 1 item 3b). Expand-only, forward-only.
--
-- Hand-written, for the recorded reason `0016`–`0024` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- ONE QUESTION, NOT A LIST OF CONDITIONS. Kd ruled on 2026-09-09 that the app is
-- a fitness app and should never ask for, or hold, a named condition. THIS row
-- stores two facts only: whether the person answered yes to "a medical
-- condition, an injury, pregnancy or anything else that could affect exercise
-- or eating", and — after a yes — whether a professional has cleared them.
-- Safe mode and "no calorie cut" are DERIVED in code from these two, never
-- stored, so the two cannot disagree. (The older free-text
-- `user_fitness_profiles.medical_conditions` column from `0006` is still
-- written by the fitness-profile screens; its future is Kd's call, asked at
-- the 3b review — this migration does not touch it.)
--
-- The second CHECK is the contradiction guard: a "cleared" with nothing to be
-- cleared of, or a yes with no choice made, can never sit in the table.
--
-- PRIVACY: still health data in the broad sense (it says a person has SOME
-- condition), so it joins `user_fitness_profiles` on the Day-14 delete list
-- and the export list (privacy/tables.ts). The FK cascade is defence in depth
-- only — §5.2 tombstones `users` rather than deleting it.
CREATE TABLE "user_health_screenings" (
  "user_id"        uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE cascade,
  "has_condition"  boolean NOT NULL,
  "check_first"    text,
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_health_screenings_check_first_check"
    CHECK ("check_first" IN ('cleared', 'not_yet')),
  CONSTRAINT "user_health_screenings_check_first_required"
    CHECK (("has_condition" AND "check_first" IS NOT NULL) OR (NOT "has_condition" AND "check_first" IS NULL))
);--> statement-breakpoint
-- THE CONSENT LOG: one row per explicit tap on a disclaimer — at sign-up, at
-- the health step and on the plan screen (RULINGS 2026-09-07) — with the time,
-- the app build that showed it and the WORDING VERBATIM. The text is copied
-- onto the row rather than referenced, so a later edit to the wording in code
-- can never change what a person agreed to. Append-only: nothing updates or
-- deletes a row here in normal operation.
--
-- KEPT after an account is purged (Kd, 2026-09-09): it is the proof the tap
-- happened, like `audit_log`, and it holds no name, address or health fact —
-- only the link to the tombstoned users row. It is on
-- `USER_LINKED_NOT_PURGED_TABLES`, IS in the data export, and the purge removes
-- it six years after the account's deletion (src/retention.ts).
CREATE TABLE "consent_log" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"          uuid NOT NULL REFERENCES "users"("id"),
  "purpose"          text NOT NULL,
  "wording_version"  text NOT NULL,
  "wording"          text NOT NULL,
  "app_version"      text NOT NULL,
  "recorded_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "consent_log_purpose_check"
    CHECK ("purpose" IN ('sign_up', 'health_step', 'plan_screen'))
);--> statement-breakpoint
CREATE INDEX "consent_log_user_recorded_idx" ON "consent_log" ("user_id", "recorded_at" DESC);
