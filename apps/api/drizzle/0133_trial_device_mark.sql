-- One device, one free trial: the browser mark (ROADMAP Stage 3 item 2c; RULINGS 2026-09-08).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `trial_device_hash`: the SHA-256 of the random mark the browser that started this free
-- trial carries in its cookie. Only the hash is kept, never the mark, and nothing about the
-- person. Null for a trial started before this column, or with no browser (the phone).
ALTER TABLE "subscriptions" ADD COLUMN "trial_device_hash" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_device_hash_check"
  CHECK ("trial_device_hash" IS NULL OR "trial_device_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
CREATE INDEX "subscriptions_trial_device_idx" ON "subscriptions" ("trial_device_hash")
  WHERE "trial_device_hash" IS NOT NULL;
