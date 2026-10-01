-- Staff invited by email (Part 3 §10.3; ROADMAP 4a-i). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- gym_staff_invites        one row an invitation: the address (readable, the owner sees
--                          whom they invited), the role, who sent it, 7 days to accept.
--                          Open = pending or declined and not cleared; one open
--                          invitation an address a gym.
-- gym_staff_invite_sends   each email, queued in the same transaction as its invitation
--                          and sent by the worker; the address is cleared when it is done.

CREATE TABLE gym_staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role text NOT NULL,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  answered_at timestamptz,
  answered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cleared_at timestamptz,
  CONSTRAINT gym_staff_invites_role_check CHECK (role IN ('manager','trainer')),
  CONSTRAINT gym_staff_invites_state_check CHECK (state IN ('pending','accepted','declined','cancelled')),
  CONSTRAINT gym_staff_invites_answered_check CHECK ((state = 'pending') = (answered_at IS NULL)),
  CONSTRAINT gym_staff_invites_cleared_check CHECK (cleared_at IS NULL OR state IN ('pending','declined')),
  CONSTRAINT gym_staff_invites_expires_check CHECK (expires_at > created_at),
  CONSTRAINT gym_staff_invites_email_length_check CHECK (length(email) BETWEEN 3 AND 254)
);--> statement-breakpoint
CREATE UNIQUE INDEX gym_staff_invites_open_uq ON gym_staff_invites (gym_id, email)
  WHERE state IN ('pending','declined') AND cleared_at IS NULL;--> statement-breakpoint
CREATE INDEX gym_staff_invites_email_idx ON gym_staff_invites (email)
  WHERE state IN ('pending','declined') AND cleared_at IS NULL;--> statement-breakpoint
CREATE INDEX gym_staff_invites_gym_idx ON gym_staff_invites (gym_id, created_at);--> statement-breakpoint
CREATE TABLE gym_staff_invite_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id uuid NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  invite_id uuid NOT NULL REFERENCES gym_staff_invites(id) ON DELETE CASCADE,
  email citext,
  state text NOT NULL DEFAULT 'queued',
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  not_before timestamptz NOT NULL,
  lease_until timestamptz,
  maybe_sent_at timestamptz,
  provider_id text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz,
  CONSTRAINT gym_staff_invite_sends_state_check CHECK (state IN ('queued','sending','sent','skipped','failed')),
  CONSTRAINT gym_staff_invite_sends_email_check CHECK (state IN ('queued','sending') OR email IS NULL),
  CONSTRAINT gym_staff_invite_sends_email_length_check CHECK (email IS NULL OR length(email) <= 254),
  CONSTRAINT gym_staff_invite_sends_lease_check CHECK ((state = 'sending') = (lease_until IS NOT NULL)),
  CONSTRAINT gym_staff_invite_sends_finished_check CHECK ((state IN ('sent','skipped','failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT gym_staff_invite_sends_reason_check CHECK ((state IN ('skipped','failed')) = (reason IS NOT NULL)),
  CONSTRAINT gym_staff_invite_sends_reason_shape_check CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,40}$'),
  CONSTRAINT gym_staff_invite_sends_provider_check CHECK (provider_id IS NULL OR (state = 'sent' AND length(provider_id) <= 100)),
  CONSTRAINT gym_staff_invite_sends_attempts_check CHECK (attempts >= 0)
);--> statement-breakpoint
CREATE INDEX gym_staff_invite_sends_due_idx ON gym_staff_invite_sends (not_before, created_at, id)
  WHERE state IN ('queued','sending');--> statement-breakpoint
CREATE INDEX gym_staff_invite_sends_gym_idx ON gym_staff_invite_sends (gym_id, created_at);--> statement-breakpoint
CREATE INDEX gym_staff_invite_sends_invite_idx ON gym_staff_invite_sends (invite_id, created_at DESC);--> statement-breakpoint
CREATE INDEX gym_staff_invite_sends_sent_idx ON gym_staff_invite_sends (finished_at) WHERE state = 'sent';
