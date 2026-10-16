-- The trial belongs to the gym (ROADMAP Stage 3 item 2d; RULINGS 2026-09-08, layer 2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `paid_at`: the first time this subscription was paid for. A gym "never paid" when none of
-- its subscriptions has one. A trigger writes it, so every writer of `subscriptions` (Paddle,
-- Razorpay, any later one) is covered without remembering to. Our own free trials and pilot
-- codes are not a payment. Backfilled for rows that are paying today; before launch nobody
-- has paid, so nothing older is lost.
ALTER TABLE "subscriptions" ADD COLUMN "paid_at" timestamptz;--> statement-breakpoint
UPDATE "subscriptions" SET "paid_at" = "created_at"
  WHERE "status" IN ('active','past_due') AND "provider" NOT IN ('none','pilot');--> statement-breakpoint
CREATE FUNCTION "subscriptions_paid_at"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."paid_at" IS NULL AND NEW."status" IN ('active','past_due')
     AND NEW."provider" NOT IN ('none','pilot') THEN
    NEW."paid_at" := now();
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "subscriptions_paid_at_trg" BEFORE INSERT OR UPDATE ON "subscriptions"
  FOR EACH ROW EXECUTE FUNCTION "subscriptions_paid_at"();--> statement-breakpoint
-- What the first-people check decided about a free trial: `ended` (most of the gym's first
-- people came from one gym that never paid, and the owner was never there) or `look` (the
-- same, but the owner was staff or a member there: the trial goes on and Kd has a look).
-- `trial_check_gym_id` is that other gym, for Kd only; no screen of the gym's shows it.
ALTER TABLE "subscriptions" ADD COLUMN "trial_check" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_check_gym_id" uuid REFERENCES "gyms"("id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_checked_at" timestamptz;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_check_check"
  CHECK ("trial_check" IS NULL OR "trial_check" IN ('ended','look'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_check_pairing_check"
  CHECK (("trial_check" IS NULL) = ("trial_check_gym_id" IS NULL)
     AND ("trial_check" IS NULL) = ("trial_checked_at" IS NULL));--> statement-breakpoint
CREATE INDEX "subscriptions_trial_look_idx" ON "subscriptions" ("trial_checked_at")
  WHERE "trial_check" = 'look';
