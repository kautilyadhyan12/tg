-- What comes back from a lead's follow-up email (spec Part 3 §16.3; ROADMAP 20c-v-b).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit.
--
-- gym_lead_sends.result   what Resend reported about an email that went, once the report
--                         was confirmed with Resend itself: the same words as an
--                         invitation's (0039), so both count toward the gym's stop.
-- gym_leads.email_hmac    the lead's address under the invitations' key, written by the
--                         app with the address, so the Leads list finds the leads whose
--                         address is on `email_suppressions` with one indexed join. Null
--                         with no address, or where no key is set.

ALTER TABLE gym_lead_sends ADD COLUMN result text;--> statement-breakpoint
ALTER TABLE gym_lead_sends ADD COLUMN result_at timestamptz;--> statement-breakpoint
ALTER TABLE gym_lead_sends ADD CONSTRAINT gym_lead_sends_result_check
  CHECK (result IS NULL OR result IN ('delivered','bounced','complained','failed','refused'));--> statement-breakpoint
-- Only an email that went has a result.
ALTER TABLE gym_lead_sends ADD CONSTRAINT gym_lead_sends_result_state_check
  CHECK (result IS NULL OR state = 'sent');--> statement-breakpoint
ALTER TABLE gym_lead_sends ADD CONSTRAINT gym_lead_sends_result_at_check
  CHECK ((result IS NULL) = (result_at IS NULL));--> statement-breakpoint
-- A report names the email by Resend's id.
CREATE INDEX gym_lead_sends_provider_idx ON gym_lead_sends (provider_id) WHERE provider_id IS NOT NULL;--> statement-breakpoint
-- The gym's counts read its sent emails in the order they went.
CREATE INDEX gym_lead_sends_gym_sent_idx ON gym_lead_sends (gym_id, finished_at) WHERE state = 'sent';--> statement-breakpoint
ALTER TABLE gym_leads ADD COLUMN email_hmac text;--> statement-breakpoint
ALTER TABLE gym_leads ADD CONSTRAINT gym_leads_email_hmac_check
  CHECK (email_hmac IS NULL OR (email IS NOT NULL AND email_hmac ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
CREATE INDEX gym_leads_email_hmac_idx ON gym_leads (email_hmac) WHERE email_hmac IS NOT NULL;
