-- A refund made inside Square shown here (ROADMAP Stage 2 item 18d-iv-d-i; spec Part 3 §14.8). Forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit.
--
-- `from_square`: a row of `gym_square_refunds` no press made: Square's own record of a refund made in Square, on a payment the app took.
-- `absorbed_minor`: how much of it staff had already noted by card, so was not written again.
-- `refunds_read_at`: when the worker last read a connection's refunds, the hourly read that catches a message Square never delivered.
-- `look_at` on a press left "We don't know": when Square's own record is read to answer it.
ALTER TABLE "gym_square_refunds" ADD COLUMN "from_square" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD COLUMN "absorbed_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_payment_connections" ADD COLUMN "refunds_read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "gym_square_refunds_lost_look_idx" ON "gym_square_refunds" ("look_at") WHERE "outcome" = 'lost' AND "look_at" IS NOT NULL;--> statement-breakpoint
UPDATE "gym_square_refunds" SET "look_at" = now() WHERE "outcome" = 'lost' AND "payment_id" IS NOT NULL AND "no_refund_at" IS NULL;
