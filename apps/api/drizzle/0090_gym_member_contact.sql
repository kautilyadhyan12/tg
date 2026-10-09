-- How members reach their gym (ROADMAP Stage 2 item 20a-iii; spec Part 3 §16.1).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The phone number and email address a gym types for its members to see in the app. Both
-- are optional. They are never `billing_mobile`, the owner's mobile for payments, and
-- nothing is copied into them. The app's own rule is stricter (`gymContact.ts`); these
-- keep out what could add to a link that calls or writes.
ALTER TABLE "gyms" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_contact_phone_check"
  CHECK ("contact_phone" IS NULL OR "contact_phone" ~ '^(\+|\(\+?)?[0-9][0-9 ()./-]{5,29}$');--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_contact_email_check"
  CHECK ("contact_email" IS NULL OR (length("contact_email") BETWEEN 3 AND 254 AND "contact_email" ~ '^[^[:space:]@]+@[^[:space:]@]+$' AND "contact_email" !~ '[?&#%,;<>]'));
