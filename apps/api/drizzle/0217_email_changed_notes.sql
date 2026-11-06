-- The note to an account's old address after Change email (ROADMAP Stage 5 19c), kept until it is sent
-- (item 19's data-integrity pass, L3: it was sent once after the move, and a failed send or a restart
-- lost it). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The move writes the row in its own transaction; the request sends it at once and deletes it, and the
-- worker sends any left from five minutes on, then 10, 20 … minutes apart (at most six hours), deleting
-- it once sent or after its last try. The old address is kept no longer than that. A deleted account's
-- notes go with it.
CREATE TABLE "email_changed_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"old_email" "citext" NOT NULL,
	"new_email" "citext" NOT NULL,
	"tries" smallint DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_changed_notes_tries_check" CHECK ("tries" >= 0)
);--> statement-breakpoint
ALTER TABLE "email_changed_notes" ADD CONSTRAINT "email_changed_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_changed_notes_next_try_idx" ON "email_changed_notes" USING btree ("next_try_at");
