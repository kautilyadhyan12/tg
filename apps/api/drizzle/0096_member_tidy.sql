-- Tidying up members whose membership is over (ROADMAP Stage 2 item 21c-iii; RULINGS 2026-10-11).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `membership_ended_on`: for a past member, the day their last membership here ended or was
-- cancelled, where it had before they were moved to Past members. Reports counts them as
-- left on that day, so a month that has closed does not change when staff tidy up later.
-- Written in the step that moves them; NULL again when they are put back.
--
-- `kept_listed_held_id`: staff pressed "Keep on list" while this membership was the one the
-- Members list read as Ended or Cancelled. The sign atop Members leaves the person out
-- until another membership of theirs is the one that reads so.
ALTER TABLE "gym_member_list_entries"
  ADD COLUMN "membership_ended_on" date,
  ADD COLUMN "kept_listed_held_id" uuid REFERENCES "gym_held_memberships" ("id") ON DELETE SET NULL;
