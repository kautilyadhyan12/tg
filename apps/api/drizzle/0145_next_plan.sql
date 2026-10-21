-- A new owner chooses their plan before a handed-over plan ends (ROADMAP Stage 2 item 4b-vi-a;
-- spec Part 3 §10.3). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part
-- of this commit.
--
-- The window: a Paddle checkout that saves the new owner's card with nothing charged until the
-- handed-over plan it follows ends (`follows_until`, that plan's end when the window was opened).
ALTER TABLE "billing_checkouts" ADD COLUMN "follows_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "follows_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_follows_subscription_fk" FOREIGN KEY ("follows_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_follows_check" CHECK (("follows_subscription_id" IS NULL) = ("follows_until" IS NULL) AND ("follows_subscription_id" IS NULL OR ("provider" = 'paddle' AND "replaces_subscription_id" IS NULL)));--> statement-breakpoint
-- The plan it made: live from the moment it is placed, its first payment at the end of the plan
-- it follows, which ends in our records then (`cancel_reason` 'followed') and at Paddle with its
-- own paid month.
ALTER TABLE "subscriptions" ADD COLUMN "follows_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_follows_subscription_fk" FOREIGN KEY ("follows_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
