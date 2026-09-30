-- The two passes over Leads (20c; reviews 2026-09-30). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- gym_leads.from_page          made by the gym's page form, not by staff or a file. The
--                              form stops taking new people at 1,000 of these still New,
--                              so a flood can never fill the gym's 10,000.
-- gym_leads.email_ok_by_page   "Happy to hear from us" was ticked by the person on the
--                              page form (anybody can type any address there), not by
--                              staff. Off whenever staff tick or untick.
-- gym_lead_sends.from_page     an email to a lead the page ticked: its bounces and spam
--                              reports count apart and can pause only the app's emails to
--                              such leads, never the gym's invitations (Kd, RULINGS
--                              2026-09-30).
-- gym_lead_sends_open_step_uq  one try at a lead's email in flight at a time, whatever
--                              its tick: the same email never twice.
-- gyms.page_emails_*           that pause, why, and where its counts start.

ALTER TABLE gym_leads ADD COLUMN from_page boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE gym_leads ADD COLUMN email_ok_by_page boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE gym_leads SET from_page = true WHERE added_by IS NULL AND enquired_at IS NOT NULL;--> statement-breakpoint
UPDATE gym_leads SET email_ok_by_page = true WHERE from_page AND email_ok_at IS NOT NULL AND email_ok_at = enquired_at;--> statement-breakpoint
ALTER TABLE gym_leads ADD CONSTRAINT gym_leads_email_ok_by_page_check
  CHECK (NOT email_ok_by_page OR email_ok_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX gym_leads_page_new_idx ON gym_leads (gym_id) WHERE from_page AND status = 'new';--> statement-breakpoint
ALTER TABLE gym_lead_sends ADD COLUMN from_page boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE UNIQUE INDEX gym_lead_sends_open_step_uq ON gym_lead_sends (lead_id, step)
  WHERE state IN ('queued','sending');--> statement-breakpoint
ALTER TABLE gyms ADD COLUMN page_emails_stopped_at timestamptz;--> statement-breakpoint
ALTER TABLE gyms ADD COLUMN page_emails_stopped_reason text;--> statement-breakpoint
ALTER TABLE gyms ADD COLUMN page_emails_counted_from timestamptz;--> statement-breakpoint
ALTER TABLE gyms ADD CONSTRAINT gyms_page_emails_stopped_check CHECK (
  (page_emails_stopped_at IS NULL) = (page_emails_stopped_reason IS NULL)
  AND (page_emails_stopped_reason IS NULL OR page_emails_stopped_reason IN ('bounces','complaint')));
