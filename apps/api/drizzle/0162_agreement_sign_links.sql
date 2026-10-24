-- Signing a membership agreement from an emailed link (ROADMAP Stage 2 item 18u-ii-b).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One link a membership: sending it again writes a new token over the old one, so only the
-- newest email's link works. The token itself is never kept, only its SHA-256 in hex. A link works
-- once its email went (`emailed_at`), until `expires_at` (the end of its last day in the
-- business's time zone), once (`used_at`), and only while the record's email address is still
-- `sent_to`. It goes with its membership, and with its record when that is deleted for good.
CREATE TABLE "gym_agreement_sign_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL,
  "held_membership_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "sent_to" text NOT NULL,
  "sent_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "emailed_at" timestamp with time zone,
  "used_at" timestamp with time zone,
  CONSTRAINT "gym_agreement_sign_links_membership_fk" FOREIGN KEY ("gym_id", "held_membership_id") REFERENCES "gym_held_memberships"("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_agreement_sign_links_one_uq" UNIQUE ("held_membership_id"),
  CONSTRAINT "gym_agreement_sign_links_token_uq" UNIQUE ("token_hash"),
  CONSTRAINT "gym_agreement_sign_links_token_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "gym_agreement_sign_links_sent_to_check" CHECK (char_length("sent_to") BETWEEN 3 AND 320),
  CONSTRAINT "gym_agreement_sign_links_expiry_check" CHECK ("expires_at" > "sent_at")
);--> statement-breakpoint
-- A signature says where it was signed: at the desk, or from the emailed link.
ALTER TABLE "gym_agreement_signatures" ADD COLUMN "signed_via" text DEFAULT 'desk' NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_agreement_signatures" ADD CONSTRAINT "gym_agreement_signatures_via_check" CHECK ("signed_via" IN ('desk', 'link'));
