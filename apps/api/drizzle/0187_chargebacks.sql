-- A chargeback shown on its payment (ROADMAP Stage 2 item 18d-iv-e-i; spec Part 3 §14.8). Forward-only. Hand-written, as `0016` onwards
-- are; its journal entry is part of this commit.
--
-- `gym_square_disputes`: Square's own record of a chargeback on a payment this gym holds, one row a dispute at a gym. The state is
-- Square's, or 'UNKNOWN' for one nobody has placed. `disputes_read_at`: when the worker last read a connection's chargebacks.
CREATE TABLE "gym_square_disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
  "environment" text NOT NULL,
  "account_id" text NOT NULL,
  "square_dispute_id" text NOT NULL,
  "square_payment_id" text NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" text NOT NULL,
  "state" text NOT NULL,
  "reason" text,
  "due_at" timestamp with time zone,
  "brand" text,
  "last4" text,
  "square_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "gym_square_disputes_state_check" CHECK ("state" IN ('INQUIRY_EVIDENCE_REQUIRED','INQUIRY_PROCESSING','INQUIRY_CLOSED','EVIDENCE_REQUIRED','PROCESSING','WON','LOST','ACCEPTED','UNKNOWN')),
  CONSTRAINT "gym_square_disputes_amount_check" CHECK ("amount_minor" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "gym_square_disputes_one_idx" ON "gym_square_disputes" ("gym_id", "environment", "square_dispute_id");--> statement-breakpoint
CREATE INDEX "gym_square_disputes_payment_idx" ON "gym_square_disputes" ("gym_id", "square_payment_id");--> statement-breakpoint
CREATE INDEX "gym_square_disputes_stops_idx" ON "gym_square_disputes" ("gym_id", "square_payment_id") WHERE "state" NOT IN ('WON','INQUIRY_CLOSED');--> statement-breakpoint
ALTER TABLE "gym_payment_connections" ADD COLUMN "disputes_read_at" timestamp with time zone;
