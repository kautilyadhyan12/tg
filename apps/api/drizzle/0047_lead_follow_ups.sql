-- A lead's three follow-up emails, sent by the gym from its own mailbox (spec Part 3
-- §16.3; ROADMAP 20c-ii; RULINGS 2026-09-27). The app sends nothing: it keeps how many
-- staff have marked as sent and the gym's day the next one is due.
ALTER TABLE gym_leads
  ADD COLUMN follow_ups_sent smallint NOT NULL DEFAULT 0,
  ADD COLUMN follow_up_last_at timestamptz,
  ADD COLUMN follow_up_due_on date,
  ADD CONSTRAINT gym_leads_follow_ups_sent_check CHECK (follow_ups_sent BETWEEN 0 AND 3),
  ADD CONSTRAINT gym_leads_follow_up_last_check CHECK ((follow_ups_sent = 0) = (follow_up_last_at IS NULL)),
  -- Only a New lead who said yes to email, with one still to send, is ever due.
  ADD CONSTRAINT gym_leads_follow_up_due_check CHECK (
    follow_up_due_on IS NULL OR (status = 'new' AND email_ok_at IS NOT NULL AND follow_ups_sent < 3));--> statement-breakpoint
CREATE INDEX gym_leads_follow_up_due_idx ON gym_leads (gym_id, follow_up_due_on) WHERE follow_up_due_on IS NOT NULL;--> statement-breakpoint
-- A New lead ticked before today is due its first on the gym's day of the tick.
UPDATE gym_leads l
SET follow_up_due_on = (l.email_ok_at AT TIME ZONE g.timezone)::date
FROM gyms g
WHERE g.id = l.gym_id
  AND l.status = 'new'
  AND l.email_ok_at IS NOT NULL
  AND g.timezone IN (SELECT name FROM pg_timezone_names);
