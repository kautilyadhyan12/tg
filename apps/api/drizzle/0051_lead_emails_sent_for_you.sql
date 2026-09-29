-- "Send them for me" (spec Part 3 §16.3; ROADMAP 20c-v-a; RULINGS 2026-09-27): the app
-- sends a lead's three follow-up emails itself, for up to 100 new leads a gym a month.
--
-- The gym's switch, and where replies go: the app's sending address has no inbox.
CREATE TABLE gym_lead_email_settings (
  gym_id uuid PRIMARY KEY REFERENCES gyms (id) ON DELETE CASCADE,
  send_for_me boolean NOT NULL DEFAULT false,
  reply_to citext,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_lead_email_settings_reply_to_check CHECK (reply_to IS NULL OR length(reply_to) BETWEEN 3 AND 254),
  CONSTRAINT gym_lead_email_settings_on_check CHECK (NOT send_for_me OR reply_to IS NOT NULL)
);--> statement-breakpoint
-- Each follow-up the app takes: one row per lead, tick and step, whatever became of it,
-- so a second run, a second worker or a retry can never send the same one again. The
-- row outlives its lead (`lead_id` set null) for the unsubscribe link in the email and
-- the month's count; it keeps the address only while it is being sent.
CREATE TABLE gym_lead_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms (id) ON DELETE CASCADE,
  lead_id uuid,
  -- The lead's "Happy to hear from us" tick this email was due under.
  ok_at timestamptz NOT NULL,
  step smallint NOT NULL,
  -- The gym's month when the app took it, and whether this lead counts in it.
  month text NOT NULL,
  counted boolean NOT NULL,
  email citext,
  email_hmac text NOT NULL,
  state text NOT NULL DEFAULT 'sending',
  reason text,
  attempts integer NOT NULL DEFAULT 1,
  not_before timestamptz NOT NULL,
  lease_until timestamptz,
  maybe_sent_at timestamptz,
  provider_id text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz,
  CONSTRAINT gym_lead_sends_lead_fk FOREIGN KEY (gym_id, lead_id)
    REFERENCES gym_leads (gym_id, id) ON DELETE SET NULL (lead_id),
  CONSTRAINT gym_lead_sends_step_check CHECK (step BETWEEN 1 AND 3),
  CONSTRAINT gym_lead_sends_month_check CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT gym_lead_sends_email_hmac_check CHECK (email_hmac ~ '^[0-9a-f]{64}$'),
  CONSTRAINT gym_lead_sends_state_check CHECK (state IN ('queued','sending','sent','skipped','failed')),
  CONSTRAINT gym_lead_sends_email_check CHECK (state IN ('queued','sending') OR email IS NULL),
  CONSTRAINT gym_lead_sends_email_length_check CHECK (email IS NULL OR length(email) <= 254),
  CONSTRAINT gym_lead_sends_lease_check CHECK ((state = 'sending') = (lease_until IS NOT NULL)),
  CONSTRAINT gym_lead_sends_finished_check CHECK ((state IN ('sent','skipped','failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT gym_lead_sends_reason_check CHECK ((state IN ('skipped','failed')) = (reason IS NOT NULL)),
  CONSTRAINT gym_lead_sends_reason_shape_check CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,40}$'),
  CONSTRAINT gym_lead_sends_provider_check CHECK (provider_id IS NULL OR (state = 'sent' AND length(provider_id) <= 100)),
  CONSTRAINT gym_lead_sends_attempts_check CHECK (attempts >= 0),
  -- Only an email that went, may have gone, or is going uses up one of the month's places.
  CONSTRAINT gym_lead_sends_counted_check CHECK (NOT counted OR state IN ('queued','sending','sent') OR reason = 'send_unknown')
);--> statement-breakpoint
CREATE UNIQUE INDEX gym_lead_sends_step_uq ON gym_lead_sends (lead_id, ok_at, step);--> statement-breakpoint
CREATE INDEX gym_lead_sends_lead_idx ON gym_lead_sends (gym_id, lead_id, ok_at);--> statement-breakpoint
CREATE INDEX gym_lead_sends_due_idx ON gym_lead_sends (not_before, id) WHERE state IN ('queued','sending');--> statement-breakpoint
CREATE INDEX gym_lead_sends_month_idx ON gym_lead_sends (gym_id, month) WHERE counted;--> statement-breakpoint
CREATE INDEX gym_lead_sends_sent_idx ON gym_lead_sends (finished_at) WHERE state = 'sent';--> statement-breakpoint
-- The worker walks a gym's due leads in the order they fell due, then in the order they
-- asked, and stops at the first it may take: in the index, so it never sorts a gym's whole
-- list to find one. It replaces 0047's (gym_id, follow_up_due_on), which it begins with.
CREATE INDEX gym_leads_follow_up_due_order_idx ON gym_leads (gym_id, follow_up_due_on, created_at, id) WHERE follow_up_due_on IS NOT NULL;--> statement-breakpoint
DROP INDEX gym_leads_follow_up_due_idx;
