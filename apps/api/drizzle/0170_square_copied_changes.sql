-- Changes copied to Square (ROADMAP Stage 2 item 18d-iii-b-ii-b-ii-b-i; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member whose customer is in Square has the name, email and phone they had when Square last agreed with them
-- (made with them, linked with them, or copied to it): `copied_name`, `copied_email`, `copied_phone`, each the md5 of
-- the value, null for none, so the table keeps no second copy of anybody's details. A part that differs from the
-- record now is a change to copy, and only that part is sent. `copied_at` null: not known yet (a customer a saved
-- card made, or one that was linked before this): the next look takes the record's details as they are, sending
-- nothing, so no detail goes to Square that the owner's press did not already put there.
--
-- `copy_refused_digest`, `copy_refused_at`: Square would not take the record's details with this digest (a phone number
-- it does not accept). Left alone until the details change, or a day has passed; the box names the member.
ALTER TABLE "gym_square_customers" ADD COLUMN "copied_name" text;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD COLUMN "copied_email" text;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD COLUMN "copied_phone" text;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD COLUMN "copied_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD COLUMN "copy_refused_digest" text;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD COLUMN "copy_refused_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD CONSTRAINT "gym_square_customers_copied_check" CHECK (("copied_name" IS NULL OR "copied_name" ~ '^[0-9a-f]{32}$') AND ("copied_email" IS NULL OR "copied_email" ~ '^[0-9a-f]{32}$') AND ("copied_phone" IS NULL OR "copied_phone" ~ '^[0-9a-f]{32}$'));
--> statement-breakpoint
ALTER TABLE "gym_square_customers" ADD CONSTRAINT "gym_square_customers_refused_check" CHECK (("copy_refused_digest" IS NULL) = ("copy_refused_at" IS NULL) AND ("copy_refused_digest" IS NULL OR "copy_refused_digest" ~ '^[0-9a-f]{32}$'));
