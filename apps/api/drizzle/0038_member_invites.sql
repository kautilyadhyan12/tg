-- Member invitations (Part 3 §9.12; ROADMAP Stage 2 item 3b-i-a). Forward-only.
--
-- Hand-written, as `0016` onwards are: `drizzle/meta/` stops at `0012_snapshot.json`.
-- Its journal entry is part of this commit.
--
-- gyms.postal_address   the gym's postal address, printed in every invitation's footer
--                       (CAN-SPAM, CASL); a gym without one cannot send.
-- gym_invites           one row per address a gym has invited, keyed by an HMAC of the
--                       lower-cased address, never the address: it outlives the list
--                       entry, so a broken export followed by a good one emails nobody
--                       twice.
-- gym_invite_sends      each email the worker is to send or has sent. The address is
--                       held only while the row waits to be sent and is cleared after.
-- email_suppressions    addresses (as the same HMAC) no invitation may go to: an
--                       unsubscribe or a complaint for one gym, a hard bounce for all.

ALTER TABLE gyms ADD COLUMN postal_address text;--> statement-breakpoint
ALTER TABLE gyms ADD CONSTRAINT gyms_postal_address_check
  CHECK (postal_address IS NULL OR length(postal_address) BETWEEN 1 AND 200);--> statement-breakpoint

CREATE TABLE gym_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  email_hmac text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One invitation an address a gym, ever: the rule "one email per person per gym".
  CONSTRAINT gym_invites_address_uq UNIQUE (gym_id, email_hmac),
  CONSTRAINT gym_invites_email_hmac_check CHECK (email_hmac ~ '^[0-9a-f]{64}$'),
  CONSTRAINT gym_invites_state_check CHECK (state IN ('pending','accepted','declined','withdrawn'))
);--> statement-breakpoint

CREATE TABLE gym_invite_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  invite_id uuid NOT NULL REFERENCES gym_invites(id) ON DELETE CASCADE,
  kind text NOT NULL,
  email citext,
  state text NOT NULL DEFAULT 'queued',
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  not_before timestamptz NOT NULL,
  lease_until timestamptz,
  provider_id text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz,
  CONSTRAINT gym_invite_sends_kind_check CHECK (kind IN ('first','again')),
  CONSTRAINT gym_invite_sends_state_check CHECK (state IN ('queued','sending','sent','skipped','failed')),
  -- The address is kept only while the email is still to go.
  CONSTRAINT gym_invite_sends_email_check CHECK (state IN ('queued','sending') OR email IS NULL),
  CONSTRAINT gym_invite_sends_email_length_check CHECK (email IS NULL OR length(email) <= 254),
  CONSTRAINT gym_invite_sends_lease_check CHECK ((state = 'sending') = (lease_until IS NOT NULL)),
  CONSTRAINT gym_invite_sends_finished_check CHECK ((state IN ('sent','skipped','failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT gym_invite_sends_reason_check CHECK ((state IN ('skipped','failed')) = (reason IS NOT NULL)),
  CONSTRAINT gym_invite_sends_reason_shape_check CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,40}$'),
  CONSTRAINT gym_invite_sends_provider_check CHECK (provider_id IS NULL OR (state = 'sent' AND length(provider_id) <= 100)),
  CONSTRAINT gym_invite_sends_attempts_check CHECK (attempts >= 0)
);--> statement-breakpoint

-- At most one first email an invitation. With gym_invites' UNIQUE, one first email an
-- address a gym, whatever presses or retries arrive.
CREATE UNIQUE INDEX gym_invite_sends_first_uq ON gym_invite_sends (invite_id) WHERE kind = 'first';--> statement-breakpoint
-- What the worker picks up next.
CREATE INDEX gym_invite_sends_due_idx ON gym_invite_sends (not_before, created_at, id)
  WHERE state IN ('queued','sending');--> statement-breakpoint
-- The daily caps: a gym's sends and the whole app's, over the last 24 hours.
CREATE INDEX gym_invite_sends_gym_sent_idx ON gym_invite_sends (gym_id, finished_at) WHERE state = 'sent';--> statement-breakpoint
CREATE INDEX gym_invite_sends_sent_idx ON gym_invite_sends (finished_at) WHERE state = 'sent';--> statement-breakpoint
-- One invitation's sends, newest first (the person's page, and "send again"'s cap).
CREATE INDEX gym_invite_sends_invite_idx ON gym_invite_sends (invite_id, created_at DESC);--> statement-breakpoint
-- "Send again" is capped a day a gym.
CREATE INDEX gym_invite_sends_gym_again_idx ON gym_invite_sends (gym_id, created_at) WHERE kind = 'again';--> statement-breakpoint

CREATE TABLE email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hmac text NOT NULL,
  gym_id uuid REFERENCES gyms(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_suppressions_email_hmac_check CHECK (email_hmac ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('unsubscribed','complained','bounced')),
  -- A hard bounce is for every gym; an unsubscribe or a complaint for one.
  CONSTRAINT email_suppressions_scope_check CHECK ((gym_id IS NULL) = (reason = 'bounced'))
);--> statement-breakpoint
CREATE UNIQUE INDEX email_suppressions_gym_uq ON email_suppressions (email_hmac, gym_id) WHERE gym_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX email_suppressions_every_gym_uq ON email_suppressions (email_hmac) WHERE gym_id IS NULL;
