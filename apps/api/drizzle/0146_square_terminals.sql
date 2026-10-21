-- A gym pairs its Square Terminal (ROADMAP Stage 2 item 18d-ii-b-i; spec Part 3 §14.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- What each connection allowed: Square's page asks for every permission at once and the gym
-- allows them all or none, so a connection made before a permission was added is asked to
-- connect again. Rows made before this column know of none.
ALTER TABLE "gym_payment_connections" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- A gym's Square Terminals, in the Square account they were paired in. `pairing`: Square's code
-- is made and waits for a Terminal to sign in with it until `pair_by`; the code itself is shown
-- once and never kept. `paired`: `device_id` is the Terminal's own id at Square (the serial
-- number under it). `practice` is one of Square's pretend Terminals, in its test area only.
CREATE TABLE "gym_square_terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"state" text NOT NULL,
	"device_code_id" text,
	"device_id" text,
	"practice" text,
	"pair_by" timestamp with time zone,
	"created_by" uuid,
	"paired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_square_terminals_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_square_terminals_state_check" CHECK ("state" IN ('pairing','paired')),
	CONSTRAINT "gym_square_terminals_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND ("device_code_id" IS NULL OR "device_code_id" ~ '^[A-Za-z0-9_-]{1,64}$') AND ("device_id" IS NULL OR "device_id" ~ '^[A-Za-z0-9:_-]{1,100}$')),
	CONSTRAINT "gym_square_terminals_pairing_check" CHECK (("state" = 'pairing') = ("device_code_id" IS NOT NULL AND "pair_by" IS NOT NULL AND "device_id" IS NULL AND "paired_at" IS NULL)),
	CONSTRAINT "gym_square_terminals_paired_check" CHECK (("state" = 'paired') = ("device_id" IS NOT NULL AND "paired_at" IS NOT NULL AND "pair_by" IS NULL)),
	CONSTRAINT "gym_square_terminals_practice_check" CHECK ("practice" IS NULL OR ("practice" IN ('saves','declines','cancels','times_out','offline') AND "environment" = 'sandbox' AND "state" = 'paired' AND "device_code_id" IS NULL))
);--> statement-breakpoint
ALTER TABLE "gym_square_terminals" ADD CONSTRAINT "gym_square_terminals_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_square_terminals" ADD CONSTRAINT "gym_square_terminals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One row a Terminal, in a gym's Square account.
CREATE UNIQUE INDEX "gym_square_terminals_device_uq" ON "gym_square_terminals" USING btree ("gym_id","environment","account_id","device_id") WHERE "device_id" IS NOT NULL;--> statement-breakpoint
-- One code waiting at a time: a new one replaces it.
CREATE UNIQUE INDEX "gym_square_terminals_pairing_uq" ON "gym_square_terminals" USING btree ("gym_id","environment") WHERE "state" = 'pairing';
