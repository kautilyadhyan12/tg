-- A gym's own page and its enquiry form (spec Part 3 §16.3; ROADMAP 20c-iv-a; RULINGS
-- 2026-09-28). The page is off until the gym switches it on; a gym with no row has
-- never touched it. A person who sends the form is a lead (added_by NULL), and every
-- message they send is kept on that lead, the newest 20.
CREATE TABLE gym_pages (
  gym_id uuid PRIMARY KEY REFERENCES gyms (id) ON DELETE CASCADE,
  shown boolean NOT NULL DEFAULT false,
  about text NOT NULL DEFAULT '',
  facilities text[] NOT NULL DEFAULT '{}',
  other_facilities text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_pages_about_len_check CHECK (char_length(about) <= 1000),
  CONSTRAINT gym_pages_facilities_check CHECK (cardinality(facilities) <= 40),
  CONSTRAINT gym_pages_other_len_check CHECK (char_length(other_facilities) <= 200)
);--> statement-breakpoint
ALTER TABLE gym_leads ADD COLUMN enquired_at timestamptz;--> statement-breakpoint
-- What a message's (gym_id, lead_id) points at: a lead of the same gym.
CREATE UNIQUE INDEX gym_leads_gym_id_uq ON gym_leads (gym_id, id);--> statement-breakpoint
CREATE TABLE gym_lead_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  full_name text NOT NULL,
  email citext,
  phone_e164 text,
  source text,
  message text NOT NULL DEFAULT '',
  may_email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_lead_enquiries_lead_fk FOREIGN KEY (gym_id, lead_id)
    REFERENCES gym_leads (gym_id, id) ON DELETE CASCADE,
  CONSTRAINT gym_lead_enquiries_name_len_check CHECK (char_length(full_name) BETWEEN 1 AND 120),
  CONSTRAINT gym_lead_enquiries_contact_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CONSTRAINT gym_lead_enquiries_source_check CHECK (source IS NULL OR source IN ('walk_in','website','social','friend','other')),
  CONSTRAINT gym_lead_enquiries_message_len_check CHECK (char_length(message) <= 1000)
);--> statement-breakpoint
CREATE INDEX gym_lead_enquiries_lead_idx ON gym_lead_enquiries (gym_id, lead_id, created_at DESC, id);
