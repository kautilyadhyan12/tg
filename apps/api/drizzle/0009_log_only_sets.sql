ALTER TABLE "workout_sets" ALTER COLUMN "engine_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sets" ALTER COLUMN "definition_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_mode_check" CHECK ("workout_sets"."mode" IN ('engine','log_only'));--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_engine_provenance_check" CHECK (("workout_sets"."mode" IS DISTINCT FROM 'engine' AND "workout_sets"."avg_form_score" IS NULL AND "workout_sets"."rep_scores" IS NULL)
          OR ("workout_sets"."engine_version" IS NOT NULL AND "workout_sets"."definition_version" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_log_only_unscored_check" CHECK ("workout_sets"."mode" IS DISTINCT FROM 'log_only'
          OR ("workout_sets"."avg_form_score" IS NULL AND "workout_sets"."rep_scores" IS NULL
              AND "workout_sets"."fault_counts" = '{}'::jsonb
              AND "workout_sets"."engine_version" IS NULL AND "workout_sets"."definition_version" IS NULL));