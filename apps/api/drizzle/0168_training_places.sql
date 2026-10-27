-- Where a person trains, apart from what they train with (ROADMAP Stage 5 item 14a; Kd, 2026-10-27, the
-- setup's click-through: "is gym a equipment? and also there should be the others yoga gym crossfit
-- pilates, personal trainer"). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part
-- of this commit.
--
-- `training_places`: any number of home · gym · yoga_studio · pilates_studio · crossfit_box ·
-- personal_trainer · outdoors, NULL until asked. "A gym" (0028) leaves the equipment: every stored "gym"
-- becomes the place, and the equipment keeps only things. A person who had picked only "A gym" keeps no
-- equipment, and setup asks that question again; nothing is guessed for them.
ALTER TABLE "user_fitness_profiles" ADD COLUMN "training_places" text[];
--> statement-breakpoint
UPDATE "user_fitness_profiles"
  SET "training_places" = ARRAY['gym']::text[],
      "available_equipment" = array_remove("available_equipment", 'gym')
  WHERE 'gym' = ANY ("available_equipment");
--> statement-breakpoint
ALTER TABLE "user_fitness_profiles" DROP CONSTRAINT "user_fitness_profiles_available_equipment_check";
--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_available_equipment_check"
    CHECK ("available_equipment" <@ ARRAY['none', 'dumbbells', 'resistance_bands', 'kettlebells', 'pull_up_bar']::text[]
           AND NOT ('none' = ANY ("available_equipment") AND cardinality("available_equipment") > 1));
--> statement-breakpoint
ALTER TABLE "user_fitness_profiles"
  ADD CONSTRAINT "user_fitness_profiles_training_places_check"
    CHECK ("training_places" <@ ARRAY['home', 'gym', 'yoga_studio', 'pilates_studio', 'crossfit_box', 'personal_trainer', 'outdoors']::text[]);
