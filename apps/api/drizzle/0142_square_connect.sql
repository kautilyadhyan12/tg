-- A gym connects its own Square account (ROADMAP Stage 2 item 18d-i; spec Part 3 §14.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this
-- commit. Numbered 0142 because web folder 2's open pull request #316 holds 0141.
--
-- One row a gym and company. The tokens are locked by the api (AES-256-GCM, a key from the
-- environment) and held only while the row is `connected`; a row the gym took off inside
-- Square is `removed` and holds none. A gym deleted for good takes its row with it.
CREATE TABLE "gym_payment_connections" (
	"gym_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"state" text NOT NULL,
	"account_id" text NOT NULL,
	"business_name" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"location_id" text,
	"location_name" text,
	"location_choices" jsonb,
	"access_token" text,
	"refresh_token" text,
	"access_expires_at" timestamp with time zone,
	"refresh_due_at" timestamp with time zone,
	"connected_by" uuid,
	"connected_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_payment_connections_pk" PRIMARY KEY("gym_id","provider"),
	CONSTRAINT "gym_payment_connections_provider_check" CHECK ("provider" IN ('square')),
	CONSTRAINT "gym_payment_connections_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_payment_connections_state_check" CHECK ("state" IN ('connected','removed')),
	CONSTRAINT "gym_payment_connections_tokens_check" CHECK (("state" = 'connected') = ("access_token" IS NOT NULL AND "refresh_token" IS NOT NULL AND "access_expires_at" IS NOT NULL AND "refresh_due_at" IS NOT NULL AND "removed_at" IS NULL)),
	CONSTRAINT "gym_payment_connections_location_check" CHECK (("location_id" IS NULL) = ("location_name" IS NULL) AND ("location_id" IS NULL OR "location_choices" IS NULL)),
	CONSTRAINT "gym_payment_connections_country_check" CHECK ("country" ~ '^[A-Z]{2}$' AND "currency" ~ '^[A-Z]{3}$')
);--> statement-breakpoint
ALTER TABLE "gym_payment_connections" ADD CONSTRAINT "gym_payment_connections_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_payment_connections" ADD CONSTRAINT "gym_payment_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Square's message about an account finds every gym holding it.
CREATE INDEX "gym_payment_connections_account_idx" ON "gym_payment_connections" USING btree ("provider","account_id");--> statement-breakpoint
-- The worker's renewals, due first.
CREATE INDEX "gym_payment_connections_refresh_idx" ON "gym_payment_connections" USING btree ("refresh_due_at") WHERE "state" = 'connected';--> statement-breakpoint
-- A press of Connect Square waiting for Square's answer: its one-time value as a SHA-256, for
-- one owner at one gym, used once, for ten minutes.
CREATE TABLE "gym_payment_connect_starts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_payment_connect_starts_provider_check" CHECK ("provider" IN ('square')),
	CONSTRAINT "gym_payment_connect_starts_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_payment_connect_starts_hash_check" CHECK ("state_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
ALTER TABLE "gym_payment_connect_starts" ADD CONSTRAINT "gym_payment_connect_starts_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_payment_connect_starts" ADD CONSTRAINT "gym_payment_connect_starts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_payment_connect_starts_expires_idx" ON "gym_payment_connect_starts" USING btree ("expires_at");--> statement-breakpoint
-- Tokens Square is still to be told to stop, written in the step that lets them go and sent
-- by the worker until Square says so. No key to the gym, so a stop outlives the gym's rows.
-- Nothing deletes a gym today; a future deletion owes its connection's stop first.
CREATE TABLE "gym_payment_revokes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"whole_account" boolean NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_payment_revokes_provider_check" CHECK ("provider" IN ('square')),
	CONSTRAINT "gym_payment_revokes_environment_check" CHECK ("environment" IN ('sandbox','production')),
	CONSTRAINT "gym_payment_revokes_tries_check" CHECK ("tries" >= 0)
);--> statement-breakpoint
CREATE INDEX "gym_payment_revokes_due_idx" ON "gym_payment_revokes" USING btree ("not_before");
