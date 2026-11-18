-- The Exercise Library on the server (spec Part 2 §13.4; ROADMAP Stage 5 job 60b). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A Library exercise that is not one of the old 58 needs a row in `exercises`, because a saved set
-- names its exercise by that row. Such a row has none of the old camera facts (name key, family,
-- tier, tracking), so they may be empty, but only on a row that is not 'live' there: the old routes
-- read only 'live' rows, so they never see one. The old 58 rows are not changed.
ALTER TABLE "exercises" ALTER COLUMN "name_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "family" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "tier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "tracking" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_old_facts_check" CHECK ("exercises"."status" <> 'live' OR ("exercises"."name_key" IS NOT NULL AND "exercises"."family" IS NOT NULL AND "exercises"."tier" IS NOT NULL AND "exercises"."tracking" IS NOT NULL));--> statement-breakpoint
CREATE TABLE "library_exercises" (
	"exercise_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"met" numeric(3, 1) NOT NULL,
	"compendium" text NOT NULL,
	"measured_in" text NOT NULL,
	"weight" text NOT NULL,
	"each_side" boolean NOT NULL,
	"entry" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_exercises_status_check" CHECK ("library_exercises"."status" IN ('live','retired','hidden','removed')),
	CONSTRAINT "library_exercises_met_check" CHECK ("library_exercises"."met" BETWEEN 1 AND 23),
	CONSTRAINT "library_exercises_compendium_check" CHECK ("library_exercises"."compendium" ~ '^[0-9]{5}$'),
	CONSTRAINT "library_exercises_measured_in_check" CHECK ("library_exercises"."measured_in" IN ('reps','time')),
	CONSTRAINT "library_exercises_weight_check" CHECK ("library_exercises"."weight" IN ('never','may','usually'))
);
--> statement-breakpoint
ALTER TABLE "library_exercises" ADD CONSTRAINT "library_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "library_copies" (
	"version" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "library_copies_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"sha256" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_copies_channel_check" CHECK ("library_copies"."channel" IN ('live','beta')),
	CONSTRAINT "library_copies_sha256_check" CHECK ("library_copies"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "library_copies_channel_version_idx" ON "library_copies" USING btree ("channel","version" DESC NULLS LAST);
