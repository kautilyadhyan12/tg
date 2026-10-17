-- The owner hands the gym to a co-owner, who accepts (ROADMAP Stage 2 item 4b-ii;
-- rulings/2026-10-17-4b-ii.md). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- One request waiting a gym. Accepting moves `gyms.owner_user_id` to the person asked; the
-- old owner's staff row stays an owner's, so they are a co-owner from then. `staff_since` is
-- the asked co-owner's staff row's `created_at` when asked, as on `gym_co_owner_requests`:
-- removed and put back, the old request no longer counts.
CREATE TABLE IF NOT EXISTS "gym_owner_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_by" uuid,
	"staff_since" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"answered_at" timestamp with time zone,
	-- When its email went: one person is emailed at most once a day by these requests.
	"emailed_at" timestamp with time zone,
	CONSTRAINT "gym_owner_requests_state_check" CHECK ("state" IN ('pending','accepted','declined','cancelled','expired')),
	CONSTRAINT "gym_owner_requests_answered_check" CHECK (("state" = 'pending') = ("answered_at" IS NULL)),
	CONSTRAINT "gym_owner_requests_expires_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD CONSTRAINT "gym_owner_requests_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD CONSTRAINT "gym_owner_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_owner_requests" ADD CONSTRAINT "gym_owner_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gym_owner_requests_pending_uq" ON "gym_owner_requests" USING btree ("gym_id") WHERE "state" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gym_owner_requests_user_idx" ON "gym_owner_requests" USING btree ("user_id") WHERE "state" = 'pending';--> statement-breakpoint
-- Who started a gym's free trial: the gym's owner at that moment. "Has this person had a
-- free trial" reads it, so a gym handed over stays counted against whoever started its
-- trial. A trigger writes it, as `paid_at`'s does, so every writer of `subscriptions` is
-- covered; backfilled from today's owners, before any gym has been handed over.
ALTER TABLE "subscriptions" ADD COLUMN "trial_started_by" uuid REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
UPDATE "subscriptions" s SET "trial_started_by" = g."owner_user_id"
  FROM "gyms" g
  WHERE s."owner_type" = 'gym' AND s."owner_id" = g."id" AND s."trial_ends_at" IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION "subscriptions_trial_started_by"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."trial_started_by" IS NULL AND NEW."owner_type" = 'gym' AND NEW."trial_ends_at" IS NOT NULL THEN
    SELECT g."owner_user_id" INTO NEW."trial_started_by" FROM "gyms" g WHERE g."id" = NEW."owner_id";
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "subscriptions_trial_started_by_trg" BEFORE INSERT OR UPDATE ON "subscriptions"
  FOR EACH ROW EXECUTE FUNCTION "subscriptions_trial_started_by"();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_trial_started_by_idx" ON "subscriptions" USING btree ("trial_started_by") WHERE "trial_ends_at" IS NOT NULL;
