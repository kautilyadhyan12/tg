-- The bank's check on the phone (ROADMAP Stage 5 item 20i-ii; Kd, 2026-11-14). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit. Renumbered from 0240: 18d-vii merged
-- its own 0240_card_requests first.
--
-- A repeating membership bought in the app is charged with Square's pass for the member's card, made on the phone once the
-- card's bank was happy. Square charges the same pass again under a new key (measured in its test area 2026-11-14), and
-- the purchase wipes the pass itself when it ends, so the purchase keeps its sha256: no two purchases at a gym share one.
ALTER TABLE "gym_app_payments" ADD COLUMN "card_pass_hash" text;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_card_pass_check" CHECK ("card_pass_hash" IS NULL OR ("card_id" IS NOT NULL AND "card_pass_hash" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
CREATE UNIQUE INDEX "gym_app_payments_card_pass_uq" ON "gym_app_payments" USING btree ("gym_id","card_pass_hash") WHERE "card_pass_hash" IS NOT NULL;
