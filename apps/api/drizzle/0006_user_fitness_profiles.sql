CREATE TABLE "user_fitness_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"age" integer,
	"gender" text,
	"height_cm" numeric(5, 2),
	"target_weight_kg" numeric(5, 2),
	"fitness_level" text,
	"fitness_goals" text[],
	"exercise_frequency" integer,
	"available_equipment" text[],
	"session_duration_min" integer,
	"preferred_workout_time" text,
	"medical_conditions" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_fitness_profiles_gender_check" CHECK ("user_fitness_profiles"."gender" IN ('male','female','other','prefer_not_to_say')),
	CONSTRAINT "user_fitness_profiles_fitness_level_check" CHECK ("user_fitness_profiles"."fitness_level" IN ('beginner','intermediate','advanced')),
	CONSTRAINT "user_fitness_profiles_preferred_workout_time_check" CHECK ("user_fitness_profiles"."preferred_workout_time" IN ('morning','afternoon','evening'))
);
--> statement-breakpoint
ALTER TABLE "user_fitness_profiles" ADD CONSTRAINT "user_fitness_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;