-- A reminder moved later today still comes (ROADMAP Stage 5 item 19e-iii). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- A save at a time already past held today in `sent_day`, the same column a real send marks, so a later
-- save at a time still to come could not tell the two apart and kept today's mark: the reminder never
-- came. The save's hold is a column of its own; only the worker's send or skip writes `sent_day`.
ALTER TABLE "training_reminders" ADD COLUMN "held_day" date;
