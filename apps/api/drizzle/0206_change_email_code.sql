-- Change email (ROADMAP Stage 5 item 19c; RULINGS 2026-09-23, E). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit. Written as 0204 and renumbered
-- 0206 when 0204 and 0205 of two other folders merged first.
--
-- A code sent to the NEW address before an account moves to it is a sign-in code of a purpose of its
-- own, counted apart from the sign-in door's and the delete code's. It is the account's as well as the
-- address's (`user_id`): one account asking for an address never ends, counts against or is found
-- instead of another account's code for it. The other purposes are the address's alone.
ALTER TABLE "sign_in_codes" DROP CONSTRAINT "sign_in_codes_purpose_check";--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_purpose_check" CHECK ("purpose" IN ('sign_in', 'delete_account', 'change_email'));--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD COLUMN "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_user_check" CHECK (("purpose" = 'change_email') = ("user_id" IS NOT NULL));
