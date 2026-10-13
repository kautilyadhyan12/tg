-- One phone at a time (ROADMAP Stage 5 item 12a; spec Part 3 §10.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A sign-in remembers where it was made: a browser (`web`, every row before this) or the
-- phone app (`phone`). A phone sign-in ends that person's other phone sign-ins, and
-- `revoked_reason` says so, so the old phone can be told why and the audit trail never
-- reads an ordinary second sign-in as a stolen token.
ALTER TABLE "refresh_tokens" ADD COLUMN "client" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_client_check" CHECK ("client" IN ('web','phone'));--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_revoked_reason_check" CHECK ("revoked_reason" IS NULL OR ("revoked_at" IS NOT NULL AND "revoked_reason" IN ('signed_in_elsewhere')));
