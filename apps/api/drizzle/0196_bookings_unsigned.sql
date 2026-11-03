-- No new bookings until the membership agreement is signed (ROADMAP Stage 2 item 18u-iv; Kd,
-- `rulings/2026-10-23-18u-i.md`). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- The gym's choice in Booking settings: `let_book`, where every gym is today, or `stop`, which
-- refuses a member's new class, waitlist and personal training booking while their own record holds
-- a membership whose agreement nobody has signed. A booking already made is never touched.
ALTER TABLE "gyms" ADD COLUMN "bookings_unsigned" text DEFAULT 'let_book' NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_bookings_unsigned_check" CHECK ("bookings_unsigned" IN ('let_book','stop'));
