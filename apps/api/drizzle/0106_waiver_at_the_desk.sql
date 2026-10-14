-- A waiver signed at the desk, and the desk's choice for somebody who has not signed
-- (ROADMAP Stage 2 item 3e-ii; spec Part 3 §10.10).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A desk signature is a RECORD's, never an app account's: staff open a person on the
-- gym's list and that person (or, for somebody under 18, a parent or guardian) types
-- their name on staff's screen. It names the wording shown, as an app signature does.
-- A record deleted for good lets go of it and the signature stays, as the gym's proof.
CREATE TABLE "gym_waiver_desk_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gym_id" uuid NOT NULL,
  "waiver_id" uuid NOT NULL,
  "entry_id" uuid,
  "signer" text NOT NULL,
  "signed_name" text NOT NULL,
  "witnessed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "signed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gym_waiver_desk_signatures_signer_check" CHECK ("signer" IN ('person', 'guardian')),
  CONSTRAINT "gym_waiver_desk_signatures_name_check" CHECK (char_length("signed_name") BETWEEN 2 AND 100),
  CONSTRAINT "gym_waiver_desk_signatures_waiver_fk" FOREIGN KEY ("gym_id", "waiver_id") REFERENCES "gym_waivers"("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_waiver_desk_signatures_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries"("gym_id", "id") ON DELETE SET NULL ("entry_id"),
  CONSTRAINT "gym_waiver_desk_signatures_one_uq" UNIQUE ("waiver_id", "entry_id")
);--> statement-breakpoint
CREATE INDEX "gym_waiver_desk_signatures_entry_idx" ON "gym_waiver_desk_signatures" ("gym_id", "entry_id");--> statement-breakpoint
-- The desk's third choice: somebody who has not signed the waiver in use is checked in
-- (where every gym starts) or sent to staff.
ALTER TABLE "gyms" ADD COLUMN "checkin_waiver" text DEFAULT 'let_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_checkin_waiver_check" CHECK ("checkin_waiver" IN ('let_in', 'see_staff'));
