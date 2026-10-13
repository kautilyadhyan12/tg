-- A gym's waiver, signed in the app (ROADMAP Stage 2 item 3e-i; RULINGS 2026-10-08).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Every wording a gym has saved is kept, numbered from 1, so a signature always points at
-- the words the person was shown. The gym's waiver today is its highest version, unless
-- the gym has stopped using it (`stopped_at`).
CREATE TABLE "gym_waivers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "body" text NOT NULL,
  "saved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "saved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stopped_at" timestamp with time zone,
  CONSTRAINT "gym_waivers_version_check" CHECK ("version" >= 1),
  CONSTRAINT "gym_waivers_body_check" CHECK (char_length("body") BETWEEN 1 AND 30000),
  CONSTRAINT "gym_waivers_gym_version_uq" UNIQUE ("gym_id", "version"),
  CONSTRAINT "gym_waivers_gym_id_uq" UNIQUE ("gym_id", "id")
);--> statement-breakpoint
-- One signature per person per wording: the same press twice is one row. `gym_id` is on
-- the row and in the foreign key, so a signature can only name its own gym's waiver.
CREATE TABLE "gym_waiver_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL,
  "waiver_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "signed_name" text NOT NULL,
  "signed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gym_waiver_signatures_name_check" CHECK (char_length("signed_name") BETWEEN 2 AND 100),
  CONSTRAINT "gym_waiver_signatures_waiver_fk" FOREIGN KEY ("gym_id", "waiver_id") REFERENCES "gym_waivers"("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_waiver_signatures_one_uq" UNIQUE ("waiver_id", "user_id")
);--> statement-breakpoint
CREATE INDEX "gym_waiver_signatures_user_idx" ON "gym_waiver_signatures" ("user_id");
