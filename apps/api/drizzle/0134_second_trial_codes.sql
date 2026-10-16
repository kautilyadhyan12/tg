-- The second-trial code (ROADMAP Stage 3 item 2e-i; RULINGS 2026-09-08, layer 4): Kd makes one
-- for a real owner of two gyms, and it lets that one person past "one free trial per person"
-- and "one device, one trial" once. Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- Neither the code nor the address is kept: `code_hash` is the code's SHA-256 and
-- `person_hash` the SHA-256 of the address's `trial_person_key`, so any spelling of the same
-- mailbox matches. A code is used once (`used_at`), for the free trial it started
-- (`subscription_id`); the first-people check (2d) leaves that trial alone, as Kd has looked.
CREATE TABLE "second_trial_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "person_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "subscription_id" uuid REFERENCES "subscriptions"("id"),
  CONSTRAINT "second_trial_codes_code_hash_uq" UNIQUE ("code_hash"),
  CONSTRAINT "second_trial_codes_subscription_uq" UNIQUE ("subscription_id"),
  CONSTRAINT "second_trial_codes_code_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "second_trial_codes_person_hash_check" CHECK ("person_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "second_trial_codes_expires_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "second_trial_codes_used_check" CHECK (("used_at" IS NULL) = ("subscription_id" IS NULL))
);
