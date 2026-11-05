-- The workout and meal reminders a person sets (ROADMAP Stage 5 item 19e-i). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row a kind, made when the person first saves it. `sent_day` is the person's own day it last went
-- or was skipped, so it goes at most once a day; `paused_at` is set when it came due and the person had
-- not opened the app for a week. The sweep reads the rows that are on and not paused.
CREATE TABLE "training_reminders" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"is_on" boolean DEFAULT false NOT NULL,
	"minute" smallint NOT NULL,
	"days" smallint DEFAULT 127 NOT NULL,
	"sent_day" date,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_reminders_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "training_reminders_kind_check" CHECK ("training_reminders"."kind" IN ('workout','breakfast','lunch','dinner')),
	CONSTRAINT "training_reminders_minute_check" CHECK ("training_reminders"."minute" BETWEEN 0 AND 1439),
	CONSTRAINT "training_reminders_days_check" CHECK ("training_reminders"."days" BETWEEN 1 AND 127)
);
--> statement-breakpoint
ALTER TABLE "training_reminders" ADD CONSTRAINT "training_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_reminders_on_idx" ON "training_reminders" USING btree ("minute") WHERE "is_on" AND "paused_at" IS NULL;
