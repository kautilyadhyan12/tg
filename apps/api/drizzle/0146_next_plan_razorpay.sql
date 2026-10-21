-- A new owner chooses their plan before a handed-over plan ends, through Razorpay too (ROADMAP
-- Stage 2 item 4b-vi-b; spec Part 3 §10.3). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- `0145` let only a Paddle checkout follow a handed-over plan: a Razorpay one may now, its first
-- payment on that plan's end (`follows_until`).
ALTER TABLE "billing_checkouts" DROP CONSTRAINT "billing_checkouts_follows_check";--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_follows_check" CHECK (("follows_subscription_id" IS NULL) = ("follows_until" IS NULL) AND ("follows_subscription_id" IS NULL OR ("provider" IN ('paddle', 'razorpay') AND "replaces_subscription_id" IS NULL)));
