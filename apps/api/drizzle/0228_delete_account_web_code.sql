-- The website's Delete your account page (ROADMAP Stage 5 item 21b-ii). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- The page emails a code to any address typed, so its codes are a purpose of their own,
-- `delete_account_web`, the address's alone. The app's delete code becomes the account's as well as
-- the address's (`user_id`), as a change-email code is: counted apart, a stranger asking the page for
-- somebody's address can never use up the codes that person asks for in the app. The app's unbound
-- codes still waiting (ten minutes at most) are removed; whoever was mid-way asks for a new one.
DELETE FROM "sign_in_codes" WHERE "purpose" = 'delete_account' AND "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "sign_in_codes" DROP CONSTRAINT "sign_in_codes_purpose_check";--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_purpose_check" CHECK ("purpose" IN ('sign_in', 'delete_account', 'delete_account_web', 'change_email'));--> statement-breakpoint
ALTER TABLE "sign_in_codes" DROP CONSTRAINT "sign_in_codes_user_check";--> statement-breakpoint
ALTER TABLE "sign_in_codes" ADD CONSTRAINT "sign_in_codes_user_check" CHECK (("purpose" IN ('change_email', 'delete_account')) = ("user_id" IS NOT NULL));
