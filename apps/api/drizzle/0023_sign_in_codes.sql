-- SIGN-IN BY 6-DIGIT EMAIL CODE (Kd ruling 2026-09-07). Expand-only, forward-only.
--
-- Hand-written, for the recorded reason `0016`–`0022` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit — a `.sql` the journal does
-- not name is applied silently and reports success.
--
-- WHY ITS OWN TABLE AND NOT A FOURTH PURPOSE ON `one_time_tokens`: that table
-- is keyed on `user_id NOT NULL`, and a sign-in code is sent to an ADDRESS that
-- may have no account yet — the account is created when the code is proved,
-- never when it is asked for (asking must not create rows for typos or for
-- addresses that are not yours). So the key here is the email.
--
-- WHAT IS STORED IS NEVER THE CODE. `code_hash` is an HMAC under a server
-- secret: a six-digit code is a million possibilities, so a plain hash would be
-- brute-forced offline in seconds from a database leak, and a keyed one cannot
-- be without the secret.
--
-- `purpose` is text + CHECK (Part 4 §1): 'sign_in' for the door, 'delete_account'
-- for the code Settings asks for before deleting an account.
--
-- PRIVACY: the table holds email addresses, and it has NO foreign key to
-- `users` (an address may have no user yet), so the privacy FK walk cannot see
-- it. Its rows are short-lived by construction: every send prunes rows older
-- than two days for every address, so nothing here outlives its purpose by
-- more than that. The `created_at` index serves that prune; the composite one
-- serves the per-address reads (the live code, the day's count).
CREATE TABLE "sign_in_codes" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"       citext NOT NULL,
  "purpose"     text NOT NULL,
  "code_hash"   text NOT NULL,
  "attempts"    integer NOT NULL DEFAULT 0,
  "expires_at"  timestamptz NOT NULL,
  "used_at"     timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sign_in_codes_purpose_check" CHECK ("purpose" IN ('sign_in', 'delete_account')),
  CONSTRAINT "sign_in_codes_attempts_check" CHECK ("attempts" >= 0)
);--> statement-breakpoint
CREATE INDEX "sign_in_codes_email_purpose_created_idx"
  ON "sign_in_codes" ("email", "purpose", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "sign_in_codes_created_idx"
  ON "sign_in_codes" ("created_at");
