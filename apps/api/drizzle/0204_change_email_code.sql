-- Change email (ROADMAP Stage 5 item 19c; RULINGS 2026-09-23, E). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- A code sent to the NEW address before an account moves to it is a sign-in code of a purpose of its
-- own, counted apart from the sign-in door's and the delete code's.
ALTER TABLE "sign_in_codes" DROP CONSTRAINT "sign_in_codes_purpose_check";--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_purpose_check" CHECK ("purpose" IN ('sign_in', 'delete_account', 'change_email'));
