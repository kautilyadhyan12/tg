-- Personal training's own booking rules (ROADMAP Stage 2 item 17e-vi; spec Part 3 §13.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Until now a session opened to members and was free to cancel by the gym's class
-- numbers (`booking_opens_days`, `booking_free_cancel_minutes`). It gets its own two,
-- and each gym's start at what its class numbers are today, so nothing changes for a gym
-- until it changes one.
ALTER TABLE "gyms" ADD COLUMN "pt_opens_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "pt_free_cancel_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
UPDATE "gyms" SET "pt_opens_days" = "booking_opens_days", "pt_free_cancel_minutes" = "booking_free_cancel_minutes";--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_pt_booking_settings_check" CHECK (
	"pt_opens_days" BETWEEN 1 AND 56
	AND "pt_free_cancel_minutes" BETWEEN 0 AND 10080
);
