-- A place in a class or an event, told to the phone (ROADMAP Stage 5 item 18b-ii-a). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
-- `push_due`: what the person on this row is owed and not yet told: `yours` (moved off the waitlist
-- into the place) or `free` (a place is free to claim). `push_occasion`: which free place they were
-- last owed a notice for, so the same free place is never told twice.
ALTER TABLE "gym_class_bookings" ADD COLUMN "push_due" text;--> statement-breakpoint
ALTER TABLE "gym_class_bookings" ADD COLUMN "push_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_class_bookings" ADD COLUMN "push_occasion" text;--> statement-breakpoint
ALTER TABLE "gym_class_bookings" ADD CONSTRAINT "gym_class_bookings_push_due_check" CHECK ("push_due" IS NULL OR ("push_due" IN ('yours','free') AND "push_due_at" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "gym_class_bookings_push_idx" ON "gym_class_bookings" ("push_due_at") WHERE "push_due" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_event_places" ADD COLUMN "push_due" text;--> statement-breakpoint
ALTER TABLE "gym_event_places" ADD COLUMN "push_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_event_places" ADD COLUMN "push_occasion" text;--> statement-breakpoint
ALTER TABLE "gym_event_places" ADD CONSTRAINT "gym_event_places_push_due_check" CHECK ("push_due" IS NULL OR ("push_due" IN ('yours','free') AND "push_due_at" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "gym_event_places_push_idx" ON "gym_event_places" ("push_due_at") WHERE "push_due" IS NOT NULL;
