-- Part 4 §1 Extensions: pgcrypto (gen_random_uuid), citext (emails), vector (§3.7)
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject_uq" UNIQUE("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext",
	"password_hash" text,
	"hash_algo" text,
	"display_name" text NOT NULL,
	"leaderboard_opt_out" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"timezone" text,
	"weight_kg" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"legacy_mongo_id" text,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id"),
	CONSTRAINT "users_hash_algo_check" CHECK ("users"."hash_algo" IN ('bcrypt','argon2id')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('active','deleted'))
);
--> statement-breakpoint
CREATE TABLE "gym_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text DEFAULT 'Front Desk' NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "gym_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"consent_at" timestamp with time zone,
	"hidden_from_boards" boolean DEFAULT false NOT NULL,
	"complimentary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_staff" (
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_staff_gym_id_user_id_pk" PRIMARY KEY("gym_id","user_id"),
	CONSTRAINT "gym_staff_role_check" CHECK ("gym_staff"."role" IN ('owner','manager','trainer'))
);
--> statement-breakpoint
CREATE TABLE "gyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"org_type" text DEFAULT 'gym' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency_display" text DEFAULT 'INR' NOT NULL,
	"logo_key" text,
	"owner_user_id" uuid NOT NULL,
	"owner_included_as_member" boolean DEFAULT true NOT NULL,
	"activation" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gyms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "gyms_org_type_check" CHECK ("gyms"."org_type" IN ('gym','studio','clinic')),
	CONSTRAINT "gyms_status_check" CHECK ("gyms"."status" IN ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"provider_ref" text,
	"issued_at" timestamp with time zone NOT NULL,
	"pdf_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_provider_ref_unique" UNIQUE("provider_ref"),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('paid','failed','refunded','void'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"audience" text NOT NULL,
	"org_types" text[],
	"name_key" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"seat_cap" integer,
	"trial_days" smallint DEFAULT 0 NOT NULL,
	"rank" smallint NOT NULL,
	"entitlements" jsonb NOT NULL,
	"member_entitlements" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code"),
	CONSTRAINT "plans_audience_check" CHECK ("plans"."audience" IN ('consumer','org')),
	CONSTRAINT "plans_interval_check" CHECK ("plans"."interval" IN ('month','year'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_owner_type_check" CHECK ("subscriptions"."owner_type" IN ('user','gym')),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" IN ('trialing','active','past_due','canceled','expired')),
	CONSTRAINT "subscriptions_provider_check" CHECK ("subscriptions"."provider" IN ('razorpay','stripe','revenuecat','pilot'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_event_uq" UNIQUE("provider","event_id"),
	CONSTRAINT "webhook_events_status_check" CHECK ("webhook_events"."status" IN ('pending','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "definition_bundles" (
	"bundle_version" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "definition_bundles_bundle_version_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"sha256" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definition_bundles_channel_check" CHECK ("definition_bundles"."channel" IN ('live','beta'))
);
--> statement-breakpoint
CREATE TABLE "exercise_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"definition" jsonb NOT NULL,
	"min_engine_version" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_definitions_exercise_version_uq" UNIQUE("exercise_id","version"),
	CONSTRAINT "exercise_definitions_status_check" CHECK ("exercise_definitions"."status" IN ('draft','beta','live','retired'))
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_key" text NOT NULL,
	"family" text NOT NULL,
	"tier" text NOT NULL,
	"tracking" text DEFAULT 'pose' NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"met" numeric(3, 1) NOT NULL,
	"difficulty" smallint,
	"equipment" text[],
	"muscles" text[],
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_slug_unique" UNIQUE("slug"),
	CONSTRAINT "exercises_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id"),
	CONSTRAINT "exercises_family_check" CHECK ("exercises"."family" ~ '^F([1-9]|1[0-2])$'),
	CONSTRAINT "exercises_tier_check" CHECK ("exercises"."tier" IN ('T1','T2','T3')),
	CONSTRAINT "exercises_tracking_check" CHECK ("exercises"."tracking" IN ('pose','timer')),
	CONSTRAINT "exercises_status_check" CHECK ("exercises"."status" IN ('live','hidden','retired'))
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"set_index" smallint NOT NULL,
	"view" text,
	"mode" text,
	"reps" smallint DEFAULT 0 NOT NULL,
	"hold_ms" integer,
	"duration_ms" integer NOT NULL,
	"avg_form_score" smallint,
	"rep_scores" smallint[],
	"fault_counts" jsonb DEFAULT '{}' NOT NULL,
	"tempo_ms_avg" integer,
	"rom_stats" jsonb,
	"calibration" jsonb,
	"engine_version" text NOT NULL,
	"definition_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_templates_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"platform" text NOT NULL,
	"engine_version" text NOT NULL,
	"bundle_version" integer,
	"sets_count" smallint DEFAULT 0 NOT NULL,
	"total_reps" integer DEFAULT 0 NOT NULL,
	"avg_form_score" smallint,
	"duration_ms" integer,
	"kcal_point" integer,
	"kcal_calc_version" smallint,
	"quality_flags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_platform_check" CHECK ("workouts"."platform" IN ('web','android','ios'))
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"weight_kg" numeric(5, 2),
	"metrics" jsonb DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurements_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "meal_log_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_log_id" uuid NOT NULL,
	"field" text NOT NULL,
	"original" jsonb NOT NULL,
	"corrected" jsonb NOT NULL,
	"portion_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"meal_name" text,
	"items" jsonb NOT NULL,
	"kcal_point" integer NOT NULL,
	"kcal_low" integer NOT NULL,
	"kcal_high" integer NOT NULL,
	"protein_g" numeric(6, 1),
	"carbs_g" numeric(6, 1),
	"fat_g" numeric(6, 1),
	"confirmed" boolean DEFAULT false NOT NULL,
	"portion_source" text NOT NULL,
	"nutrition_sources" text[] NOT NULL,
	"calc_version" smallint NOT NULL,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_logs_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "user_dishware" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"container_class" text NOT NULL,
	"volume_ml" integer NOT NULL,
	"food_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_micro" bigint,
	"currency" text DEFAULT 'USD',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_messages_role_check" CHECK ("coach_messages"."role" IN ('user','assistant','system'))
);
--> statement-breakpoint
CREATE TABLE "coach_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"last_message_at" timestamp with time zone,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_threads_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb DEFAULT '{}' NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunks_doc_chunk_uq" UNIQUE("doc","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"code" text PRIMARY KEY NOT NULL,
	"name_key" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_participants" (
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"progress" jsonb DEFAULT '{}' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_participants_challenge_id_user_id_pk" PRIMARY KEY("challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"gym_id" uuid,
	"template_code" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenges_scope_check" CHECK ("challenges"."scope" IN ('user','org','global')),
	CONSTRAINT "challenges_status_check" CHECK ("challenges"."status" IN ('active','ended','canceled'))
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid,
	"board" text NOT NULL,
	"period" text NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_snapshots_gym_board_period_uq" UNIQUE("gym_id","board","period")
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"last_activity_date" date,
	"freezes_available" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_code_pk" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "geo_cache" (
	"lat3" numeric(7, 3) NOT NULL,
	"lng3" numeric(7, 3) NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geo_cache_lat3_lng3_pk" PRIMARY KEY("lat3","lng3")
);
--> statement-breakpoint
CREATE TABLE "run_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_schedules_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"polyline" text,
	"route_name" text,
	"splits" jsonb,
	"kcal_point" integer,
	"kcal_calc_version" smallint,
	"source" text DEFAULT 'mobile' NOT NULL,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "saved_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"polyline" text NOT NULL,
	"distance_m" integer NOT NULL,
	"legacy_mongo_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_routes_legacy_mongo_id_unique" UNIQUE("legacy_mongo_id")
);
--> statement-breakpoint
CREATE TABLE "api_cost_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_cost_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"gym_id" uuid,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"units" numeric(12, 4) NOT NULL,
	"unit_type" text NOT NULL,
	"cost_micro" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"day" date NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "usage_daily_user_id_feature_day_pk" PRIMARY KEY("user_id","feature","day")
);
--> statement-breakpoint
CREATE TABLE "gym_usage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"period" text NOT NULL,
	"stats" jsonb NOT NULL,
	"pdf_key" text,
	"emailed_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_usage_reports_gym_period_uq" UNIQUE("gym_id","period")
);
--> statement-breakpoint
CREATE TABLE "org_daily_stats" (
	"gym_id" uuid NOT NULL,
	"day" date NOT NULL,
	"active_members" integer NOT NULL,
	"workouts" integer NOT NULL,
	"sets" integer NOT NULL,
	"total_reps" integer NOT NULL,
	"minutes" integer NOT NULL,
	"avg_form_score" numeric(4, 1),
	"scored_sets" integer NOT NULL,
	"new_members" integer NOT NULL,
	"removed_members" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_daily_stats_gym_id_day_pk" PRIMARY KEY("gym_id","day")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"gym_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"user_id" uuid NOT NULL,
	"token" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"engine_version" text NOT NULL,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trace_samples_verdict_check" CHECK ("trace_samples"."verdict" IN ('pending','match','mismatch','error'))
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_codes" ADD CONSTRAINT "gym_codes_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_members" ADD CONSTRAINT "gym_members_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_members" ADD CONSTRAINT "gym_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_members" ADD CONSTRAINT "gym_members_code_id_gym_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."gym_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_definitions" ADD CONSTRAINT "exercise_definitions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_definitions" ADD CONSTRAINT "exercise_definitions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_log_corrections" ADD CONSTRAINT "meal_log_corrections_meal_log_id_meal_logs_id_fk" FOREIGN KEY ("meal_log_id") REFERENCES "public"."meal_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dishware" ADD CONSTRAINT "user_dishware_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_thread_id_coach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coach_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_threads" ADD CONSTRAINT "coach_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_code_achievements_code_fk" FOREIGN KEY ("code") REFERENCES "public"."achievements"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_schedules" ADD CONSTRAINT "run_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_routes" ADD CONSTRAINT "saved_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_usage_reports" ADD CONSTRAINT "gym_usage_reports_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_daily_stats" ADD CONSTRAINT "org_daily_stats_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_family_idx" ON "refresh_tokens" USING btree ("user_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_members_live_uq" ON "gym_members" USING btree ("gym_id","user_id") WHERE "gym_members"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_members_gym_removed_idx" ON "gym_members" USING btree ("gym_id","removed_at");--> statement-breakpoint
CREATE INDEX "gym_members_user_removed_idx" ON "gym_members" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE INDEX "gym_members_gym_joined_idx" ON "gym_members" USING btree ("gym_id","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subs_one_live_uq" ON "subscriptions" USING btree ("owner_type","owner_id") WHERE "subscriptions"."status" IN ('trialing','active','past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "exercise_definitions_exercise_status_idx" ON "exercise_definitions" USING btree ("exercise_id","status");--> statement-breakpoint
CREATE INDEX "workout_sets_workout_idx" ON "workout_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_sets_user_started_idx" ON "workout_sets" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workout_sets_exercise_started_idx" ON "workout_sets" USING btree ("exercise_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workouts_user_started_idx" ON "workouts" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "body_measurements_user_measured_idx" ON "body_measurements" USING btree ("user_id","measured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_logs_user_taken_idx" ON "meal_logs" USING btree ("user_id","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coach_messages_thread_created_idx" ON "coach_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_user_started_idx" ON "runs" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_cost_events_gym_at_idx" ON "api_cost_events" USING btree ("gym_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_gym_at_idx" ON "audit_log" USING btree ("gym_id","at" DESC NULLS LAST);
--> statement-breakpoint
-- BRIN indexes (Part 4 §3.5, §3.10, §3.12 — drizzle-kit cannot emit USING brin)
CREATE INDEX "workouts_started_brin" ON "workouts" USING brin ("started_at");--> statement-breakpoint
CREATE INDEX "sets_started_brin" ON "workout_sets" USING brin ("started_at");--> statement-breakpoint
CREATE INDEX "cost_at_brin" ON "api_cost_events" USING brin ("at");--> statement-breakpoint
CREATE INDEX "audit_at_brin" ON "audit_log" USING brin ("at");--> statement-breakpoint
-- Part 4 §3.11 org_member_stats view (verbatim from spec)
CREATE VIEW org_member_stats AS
SELECT m.id AS membership_id, m.gym_id, m.user_id, u.display_name,
         c.label AS group_label, m.joined_at, m.hidden_from_boards,
         u.last_active_at,
         (SELECT count(*) FROM workouts w WHERE w.user_id = m.user_id
            AND w.started_at >= now() - interval '30 days'
            AND w.started_at >= m.joined_at) AS workouts_30d,
         (SELECT round(avg(s.avg_form_score),0) FROM workout_sets s
            WHERE s.user_id = m.user_id AND s.avg_form_score IS NOT NULL
            AND s.started_at >= now() - interval '30 days'
            AND s.started_at >= m.joined_at) AS avg_form_30d
FROM gym_members m JOIN users u ON u.id = m.user_id
LEFT JOIN gym_codes c ON c.id = m.code_id
WHERE m.removed_at IS NULL AND u.status = 'active';
