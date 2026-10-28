-- Changes copied to Square (ROADMAP Stage 2 item 18d-iii-b-ii-b-ii-b-i; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member whose customer is in Square has the name, email and phone they had when Square last agreed with them
-- (made with them, linked with them, or copied to it): `copied_name`, `copied_email`, `copied_phone`, each the md5 of
-- the value, null for none, so the table keeps no second copy of anybody's details. A part that differs from the
-- record now is a change to copy, and only that part is sent. `copied_at` null: not known (a row no path marked): the
-- next look takes the record's details as they are, sending nothing, so no detail goes to Square on a guess. Every
-- customer made or linked before this is marked by the last statement below, and every later one when it is made.
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
--> statement-breakpoint
-- Every customer made or linked before this agrees with its record as the record is now: the first change made after this is a
-- change to copy, never taken as what Square already holds (a pass that took the record only after its first edit would have
-- swallowed that edit). Customers made later are marked when they are made.
UPDATE "gym_square_customers" c
SET "copied_name" = md5(e."full_name"), "copied_email" = md5(NULLIF(lower(btrim(e."email"::text)), '')), "copied_phone" = md5(NULLIF(e."phone_e164", '')), "copied_at" = now()
FROM "gym_member_list_entries" e
WHERE e."gym_id" = c."gym_id" AND e."id" = c."entry_id" AND c."customer_id" IS NOT NULL AND c."copied_at" IS NULL;
