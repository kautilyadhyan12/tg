-- Online classes (ROADMAP Stage 2 item 17g; spec Part 3 §13.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A time slot marked online carries the gym's own video link, and each class on the
-- calendar its own copy, stamped when it is written. `online_alone`: staff set this one
-- class's link on its own, so a later change to its time slot's link leaves it.
ALTER TABLE "gym_class_schedules" ADD COLUMN "online" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD COLUMN "online_link" text;--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD CONSTRAINT "gym_class_schedules_online_link_check" CHECK ("online_link" IS NULL OR ("online" AND char_length("online_link") <= 500 AND "online_link" LIKE 'https://%'));--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD COLUMN "online" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD COLUMN "online_link" text;--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD COLUMN "online_alone" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD CONSTRAINT "gym_class_sessions_online_link_check" CHECK ("online_link" IS NULL OR ("online" AND char_length("online_link") <= 500 AND "online_link" LIKE 'https://%'));
