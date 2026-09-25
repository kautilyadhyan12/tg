-- A gym's leads (spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- gym_leads  people who asked about the gym and have not joined. One lead per email
--            and per phone in a gym (the two partial UNIQUEs), so a person typed in
--            twice is one lead. `entry_id` is the member record a joined lead is on
--            the list as, and only a joined lead has one: held with the gym in the
--            key, as `gym_members.entry_id` is (0040), so a lead can only point at its
--            own gym's record; a record deleted for good clears it, and joining two
--            records moves it. `email_ok_at` is when staff ticked "Happy to hear from
--            us": only with an email, and cleared when the email changes. `added_by`
--            is the only user link (privacy/tables.ts).

CREATE TABLE gym_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email citext,
  phone_e164 text,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  notes text NOT NULL DEFAULT '',
  email_ok_at timestamptz,
  entry_id uuid,
  added_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_leads_name_len_check CHECK (char_length(full_name) BETWEEN 1 AND 120),
  CONSTRAINT gym_leads_contact_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CONSTRAINT gym_leads_source_check CHECK (source IN ('walk_in','website','social','friend','other')),
  CONSTRAINT gym_leads_status_check CHECK (status IN ('new','contacted','on_trial','joined','lost')),
  CONSTRAINT gym_leads_notes_len_check CHECK (char_length(notes) <= 2000),
  CONSTRAINT gym_leads_email_ok_check CHECK (email_ok_at IS NULL OR email IS NOT NULL),
  CONSTRAINT gym_leads_entry_check CHECK (entry_id IS NULL OR status = 'joined'),
  CONSTRAINT gym_leads_entry_fk FOREIGN KEY (gym_id, entry_id)
    REFERENCES gym_member_list_entries (gym_id, id) ON DELETE SET NULL (entry_id)
);--> statement-breakpoint
CREATE UNIQUE INDEX gym_leads_gym_email_uq ON gym_leads (gym_id, email) WHERE email IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX gym_leads_gym_phone_uq ON gym_leads (gym_id, phone_e164) WHERE phone_e164 IS NOT NULL;--> statement-breakpoint
CREATE INDEX gym_leads_gym_created_idx ON gym_leads (gym_id, created_at, id);--> statement-breakpoint
CREATE INDEX gym_leads_gym_status_created_idx ON gym_leads (gym_id, status, created_at, id);--> statement-breakpoint
-- A record's delete and a join of two records look leads up by the record; this keeps
-- either from reading every lead.
CREATE INDEX gym_leads_entry_idx ON gym_leads (entry_id) WHERE entry_id IS NOT NULL;
