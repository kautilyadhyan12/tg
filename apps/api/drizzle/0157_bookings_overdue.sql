-- No new bookings while a payment is overdue (ROADMAP Stage 2 item 17i; Kd, `rulings/2026-10-23-17i.md`).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's choice in Booking settings: `let_book`, where every gym is today, or `stop`, which
-- refuses a member's new class, waitlist and personal training booking while their payment reads
-- Overdue. A booking already made is never touched.
ALTER TABLE "gyms" ADD COLUMN "bookings_overdue" text DEFAULT 'let_book' NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_bookings_overdue_check" CHECK ("bookings_overdue" IN ('let_book','stop'));
