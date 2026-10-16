-- Staff activity's worker filter (ROADMAP Stage 2 item 4d). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- The filter lists the gym's former staff, read from its `org.staff_removed` notes. Without
-- this index that read walks every note the gym has (measured 2026-10-15: 350 ms for a gym
-- with 300,000 notes); with it, only the removals.
CREATE INDEX IF NOT EXISTS "audit_log_staff_removed_idx" ON "audit_log" USING btree ("gym_id") WHERE "action" = 'org.staff_removed';
