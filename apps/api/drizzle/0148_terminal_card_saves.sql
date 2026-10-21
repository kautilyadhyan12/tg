-- Save card on Terminal (ROADMAP Stage 2 item 18d-ii-b-ii; spec Part 3 §14.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A card saved on the gym's Square Terminal: the person reads the gym's agreement on the
-- Terminal and taps I agree (Square's CONFIRMATION action), then inserts or swipes their card
-- (Square's SAVE_CARD action, on the person's own Square customer). One row a press, while it
-- waits at the Terminal and for a day after. `agreeing` and `saving` are open; `saved` and
-- `not_saved` are done, with why in `outcome`. The key each action is asked with is kept, so
-- asking again gives back the same action. A card is kept only while the gym is still on the
-- Square account the press began with.
--
-- A record deleted for good, or joined to another, lets go of its row's `entry_id`: whatever
-- the Terminal then saves is stopped at Square and never kept. The link sets `entry_id` alone
-- to null (Postgres 15 onwards), which Drizzle cannot write, so the schema file leaves it out.
CREATE TABLE "gym_terminal_card_saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"device_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"state" text NOT NULL,
	"outcome" text,
	"words" text NOT NULL,
	"confirm_key" uuid NOT NULL,
	"confirm_action_id" text,
	"picked_up" boolean DEFAULT false NOT NULL,
	"agreed_at" timestamp with time zone,
	"save_key" uuid NOT NULL,
	"save_action_id" text,
	"card_id" text,
	"started_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"checking_until" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "gym_terminal_card_saves_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_terminal_card_saves_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "device_id" ~ '^[A-Za-z0-9:_-]{1,100}$' AND "customer_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND ("confirm_action_id" IS NULL OR "confirm_action_id" ~ '^[A-Za-z0-9:_-]{1,255}$') AND ("save_action_id" IS NULL OR "save_action_id" ~ '^[A-Za-z0-9:_-]{1,255}$') AND ("card_id" IS NULL OR "card_id" ~ '^[A-Za-z0-9:_-]{1,192}$')),
	CONSTRAINT "gym_terminal_card_saves_state_check" CHECK ("state" IN ('agreeing','saving','saved','not_saved')),
	CONSTRAINT "gym_terminal_card_saves_outcome_check" CHECK (("state" IN ('agreeing','saving')) = ("outcome" IS NULL AND "finished_at" IS NULL) AND ("outcome" IS NULL OR "outcome" IN ('saved','not_agreed','cancelled_on_terminal','timed_out','no_answer','cancelled','refused','gone'))),
	CONSTRAINT "gym_terminal_card_saves_saved_check" CHECK (("state" = 'saved') = ("outcome" IS NOT DISTINCT FROM 'saved') AND ("state" <> 'saved' OR ("card_id" IS NOT NULL AND "agreed_at" IS NOT NULL))),
	CONSTRAINT "gym_terminal_card_saves_agreed_check" CHECK ("state" NOT IN ('saving','saved') OR "agreed_at" IS NOT NULL),
	CONSTRAINT "gym_terminal_card_saves_words_check" CHECK (char_length("words") BETWEEN 20 AND 600)
);--> statement-breakpoint
ALTER TABLE "gym_terminal_card_saves" ADD CONSTRAINT "gym_terminal_card_saves_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_terminal_card_saves" ADD CONSTRAINT "gym_terminal_card_saves_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_terminal_card_saves" ADD CONSTRAINT "gym_terminal_card_saves_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The same press sent twice is one save.
CREATE UNIQUE INDEX "gym_terminal_card_saves_request_uq" ON "gym_terminal_card_saves" USING btree ("gym_id","request_key");--> statement-breakpoint
-- A Terminal does one thing at a time, whichever gym on its Square account asked.
CREATE UNIQUE INDEX "gym_terminal_card_saves_device_uq" ON "gym_terminal_card_saves" USING btree ("environment","account_id","device_id") WHERE "state" IN ('agreeing','saving');--> statement-breakpoint
-- One save waits for a person at a time.
CREATE UNIQUE INDEX "gym_terminal_card_saves_entry_uq" ON "gym_terminal_card_saves" USING btree ("gym_id","entry_id") WHERE "state" IN ('agreeing','saving') AND "entry_id" IS NOT NULL;--> statement-breakpoint
-- The worker's search for saves nobody is asking about, and for done ones to forget.
CREATE INDEX "gym_terminal_card_saves_open_idx" ON "gym_terminal_card_saves" USING btree ("checked_at") WHERE "state" IN ('agreeing','saving');--> statement-breakpoint
CREATE INDEX "gym_terminal_card_saves_done_idx" ON "gym_terminal_card_saves" USING btree ("finished_at") WHERE "finished_at" IS NOT NULL;--> statement-breakpoint
-- A card saved on a Terminal, and the agreement given on it: `device_id` is the Terminal the
-- person tapped I agree on (their own screen there; `screen_user_id` is the member of staff
-- who started it at the desk).
ALTER TABLE "gym_card_agreements" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "gym_card_agreements" DROP CONSTRAINT "gym_card_agreements_screen_check";--> statement-breakpoint
ALTER TABLE "gym_card_agreements" ADD CONSTRAINT "gym_card_agreements_screen_check" CHECK ("screen" IN ('desk','app','terminal') AND ("screen" = 'terminal') = ("device_id" IS NOT NULL) AND ("device_id" IS NULL OR "device_id" ~ '^[A-Za-z0-9:_-]{1,100}$'));--> statement-breakpoint
ALTER TABLE "gym_member_cards" DROP CONSTRAINT "gym_member_cards_saved_from_check";--> statement-breakpoint
ALTER TABLE "gym_member_cards" ADD CONSTRAINT "gym_member_cards_saved_from_check" CHECK ("saved_from" IN ('desk','app','terminal'));
