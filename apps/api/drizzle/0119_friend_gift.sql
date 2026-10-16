-- Refer a friend: the friend's gift given (ROADMAP Stage 2 item 20e-ii-b-i; spec Part 3 §16.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Which of a business's discounts are Refer a friend's own friend's gift, now and before:
-- one is given only to somebody a member invited, once, and is offered nowhere else. The
-- gift in use is the offer's `friend_discount_id`, marked here; Refer a friend went out on
-- 2026-10-15 and nobody has used it, so no gift it replaced needs marking.
ALTER TABLE "gym_discounts" ADD COLUMN "referral_gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "gym_discounts" d SET "referral_gift" = true
FROM "gym_referral_settings" s
WHERE s."gym_id" = d."gym_id" AND s."friend_discount_id" = d."id";
