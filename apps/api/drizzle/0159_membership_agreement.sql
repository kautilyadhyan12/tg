-- A business's membership agreement, signed for each membership (ROADMAP Stage 2 item
-- 18u-i; rulings/2026-10-23-18u-i.md). Forward-only. Hand-written, as `0016` onwards are;
-- its journal entry is part of this commit.
--
-- The business writes its own words; every wording it saves is kept, numbered from 1, as a
-- waiver's is (`0103`). Its agreement today is its highest version, unless it stopped using
-- it (`stopped_at`).
CREATE TABLE "gym_agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "body" text NOT NULL,
  "saved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "saved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stopped_at" timestamp with time zone,
  CONSTRAINT "gym_agreements_version_check" CHECK ("version" >= 1),
  CONSTRAINT "gym_agreements_body_check" CHECK (char_length("body") BETWEEN 1 AND 30000),
  CONSTRAINT "gym_agreements_gym_version_uq" UNIQUE ("gym_id", "version"),
  CONSTRAINT "gym_agreements_gym_id_uq" UNIQUE ("gym_id", "id")
);--> statement-breakpoint
-- One signature per membership, made on staff's screen at the desk by the person (or, for
-- somebody under 18, a parent or guardian). It keeps what the person read word for word:
-- the wording's id and `facts`, the membership's details as the screen showed them. It is
-- the gym's proof: a record deleted for good lets go of it with the day (`record_deleted_at`)
-- and the purge removes it six years later, as a waiver signed at the desk (3e-iii); a
-- membership deleted with its record lets go of it the same way.
CREATE TABLE "gym_agreement_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL,
  "agreement_id" uuid NOT NULL,
  "held_membership_id" uuid,
  "signer" text NOT NULL,
  "signed_name" text NOT NULL,
  "facts" jsonb NOT NULL,
  "witnessed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "signed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "emailed_at" timestamp with time zone,
  "record_deleted_at" timestamp with time zone,
  CONSTRAINT "gym_agreement_signatures_signer_check" CHECK ("signer" IN ('person', 'guardian')),
  CONSTRAINT "gym_agreement_signatures_name_check" CHECK (char_length("signed_name") BETWEEN 2 AND 100),
  CONSTRAINT "gym_agreement_signatures_facts_check" CHECK (jsonb_typeof("facts") = 'array' AND jsonb_array_length("facts") BETWEEN 1 AND 30),
  CONSTRAINT "gym_agreement_signatures_agreement_fk" FOREIGN KEY ("gym_id", "agreement_id") REFERENCES "gym_agreements"("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_agreement_signatures_membership_fk" FOREIGN KEY ("gym_id", "held_membership_id") REFERENCES "gym_held_memberships"("gym_id", "id") ON DELETE SET NULL ("held_membership_id"),
  CONSTRAINT "gym_agreement_signatures_one_uq" UNIQUE ("held_membership_id")
);--> statement-breakpoint
CREATE INDEX "gym_agreement_signatures_membership_idx" ON "gym_agreement_signatures" ("gym_id", "held_membership_id");--> statement-breakpoint
CREATE INDEX "gym_agreement_signatures_deleted_idx" ON "gym_agreement_signatures" ("record_deleted_at") WHERE "record_deleted_at" IS NOT NULL;
