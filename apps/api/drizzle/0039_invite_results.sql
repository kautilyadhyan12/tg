-- What comes back from an invitation email (Part 3 §9.12; ROADMAP Stage 2 item 3b-i-b).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- gyms.invites_stopped_*      a gym whose invitations bounced or were marked as spam
--                             too often: it sends nothing until it is started again
--                             (`tools/invites-stopped.ts`). The gyms stopped are Kd's
--                             "have a look" list.
-- gyms.invites_counted_from   where the gym's bounce and complaint counts start: null
--                             for its first email, the moment it was started again after.
-- gym_invite_sends.result     what Resend reported about an email that went, once the
--                             report was confirmed with Resend itself.
-- email_suppressions          gains 'refused': an address Resend itself will not send to
--                             (its own list, which a bounce or a complaint about ANY of
--                             the account's email puts it on). Every gym's, like a bounce,
--                             but never counted as a bounce against a gym.
-- webhook_events              gains a retry time, the claim's number (attempts) and the
--                             tries at confirming it (tries): a report is acted on only
--                             after Resend's own record of the email agrees with it.

ALTER TABLE gyms ADD COLUMN invites_stopped_at timestamptz;--> statement-breakpoint
ALTER TABLE gyms ADD COLUMN invites_stopped_reason text;--> statement-breakpoint
ALTER TABLE gyms ADD COLUMN invites_counted_from timestamptz;--> statement-breakpoint
ALTER TABLE gyms ADD CONSTRAINT gyms_invites_stopped_reason_check
  CHECK (invites_stopped_reason IS NULL OR invites_stopped_reason IN ('bounces','complaint'));--> statement-breakpoint
ALTER TABLE gyms ADD CONSTRAINT gyms_invites_stopped_check
  CHECK ((invites_stopped_at IS NULL) = (invites_stopped_reason IS NULL));--> statement-breakpoint

ALTER TABLE gym_invite_sends ADD COLUMN result text;--> statement-breakpoint
ALTER TABLE gym_invite_sends ADD COLUMN result_at timestamptz;--> statement-breakpoint
ALTER TABLE gym_invite_sends ADD CONSTRAINT gym_invite_sends_result_check
  CHECK (result IS NULL OR result IN ('delivered','bounced','complained','failed','refused'));--> statement-breakpoint
-- Only an email that went has a result.
ALTER TABLE gym_invite_sends ADD CONSTRAINT gym_invite_sends_result_state_check
  CHECK (result IS NULL OR state = 'sent');--> statement-breakpoint
ALTER TABLE gym_invite_sends ADD CONSTRAINT gym_invite_sends_result_at_check
  CHECK ((result IS NULL) = (result_at IS NULL));--> statement-breakpoint
-- A report names the email by Resend's id.
CREATE INDEX gym_invite_sends_provider_idx ON gym_invite_sends (provider_id) WHERE provider_id IS NOT NULL;--> statement-breakpoint

ALTER TABLE webhook_events ADD COLUMN attempts integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE webhook_events ADD COLUMN not_before timestamptz NOT NULL DEFAULT now();--> statement-breakpoint
ALTER TABLE webhook_events ADD COLUMN tries integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_attempts_check CHECK (attempts >= 0);--> statement-breakpoint
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_tries_check CHECK (tries >= 0);--> statement-breakpoint

ALTER TABLE email_suppressions DROP CONSTRAINT email_suppressions_reason_check;--> statement-breakpoint
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_reason_check
  CHECK (reason IN ('unsubscribed','complained','bounced','refused'));--> statement-breakpoint
ALTER TABLE email_suppressions DROP CONSTRAINT email_suppressions_scope_check;--> statement-breakpoint
-- A hard bounce and a refusal are for every gym; an unsubscribe or a complaint for one.
ALTER TABLE email_suppressions ADD CONSTRAINT email_suppressions_scope_check
  CHECK ((gym_id IS NULL) = (reason IN ('bounced','refused')));--> statement-breakpoint
CREATE INDEX webhook_events_due_idx ON webhook_events (provider, not_before) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX webhook_events_processed_idx ON webhook_events (processed_at) WHERE status <> 'pending';
