-- Each Change email (ROADMAP Stage 5 19c), kept for the 14 days its Undo link works (item 19's two
-- extra passes: the security pass's H1, Kd 2026-11-06, and the data-integrity pass's L3). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The move writes the row in its own transaction. The note to the old address carries an Undo this
-- change link: the request sends it at once, and the worker sends it again from five minutes on, then
-- 10, 20 … minutes apart (at most six hours), until the provider takes it (`note_next_try_at` NULL once
-- sent or given up). The link's token is never stored: it is worked out again from the row's id and the
-- server's secret, and only its SHA-256 is kept. A link works until `expires_at`, once (`undone_at`), and
-- not after a later undo of the same account (`ended_at`). For those 14 days nobody can start a new
-- account with the old address. The worker deletes a row once its days are over; a deleted account's
-- rows go with it.
CREATE TABLE "email_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"old_email" "citext" NOT NULL,
	"new_email" "citext" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"undone_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"note_tries" smallint DEFAULT 0 NOT NULL,
	"note_next_try_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_changes_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_changes_note_tries_check" CHECK ("note_tries" >= 0)
);--> statement-breakpoint
ALTER TABLE "email_changes" ADD CONSTRAINT "email_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_changes_user_idx" ON "email_changes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_changes_old_email_idx" ON "email_changes" USING btree ("old_email");--> statement-breakpoint
CREATE INDEX "email_changes_note_next_try_idx" ON "email_changes" USING btree ("note_next_try_at") WHERE "note_next_try_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_changes_expires_idx" ON "email_changes" USING btree ("expires_at");
