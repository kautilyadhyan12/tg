// The Achievements medals (ROADMAP Stage 5 35c-iii), made by docs/design/phone/medals/make.py from Kd's
// approved drawing: each badge earned and locked, each challenge coin in its three metals and grey, and the
// leaderboard's I, II and III. A picture is named as its file.
import coinFamiliesBronze from "../../assets/medals/coin_families_bronze.webp";
import coinFamiliesBronzeGrey from "../../assets/medals/coin_families_bronze_grey.webp";
import coinFamiliesGold from "../../assets/medals/coin_families_gold.webp";
import coinFamiliesGoldGrey from "../../assets/medals/coin_families_gold_grey.webp";
import coinFamiliesSilver from "../../assets/medals/coin_families_silver.webp";
import coinFamiliesSilverGrey from "../../assets/medals/coin_families_silver_grey.webp";
import coinFoodDaysBronze from "../../assets/medals/coin_food_days_bronze.webp";
import coinFoodDaysBronzeGrey from "../../assets/medals/coin_food_days_bronze_grey.webp";
import coinFoodDaysGold from "../../assets/medals/coin_food_days_gold.webp";
import coinFoodDaysGoldGrey from "../../assets/medals/coin_food_days_gold_grey.webp";
import coinFoodDaysSilver from "../../assets/medals/coin_food_days_silver.webp";
import coinFoodDaysSilverGrey from "../../assets/medals/coin_food_days_silver_grey.webp";
import coinForm80WorkoutsBronze from "../../assets/medals/coin_form_80_workouts_bronze.webp";
import coinForm80WorkoutsBronzeGrey from "../../assets/medals/coin_form_80_workouts_bronze_grey.webp";
import coinForm80WorkoutsGold from "../../assets/medals/coin_form_80_workouts_gold.webp";
import coinForm80WorkoutsGoldGrey from "../../assets/medals/coin_form_80_workouts_gold_grey.webp";
import coinForm80WorkoutsSilver from "../../assets/medals/coin_form_80_workouts_silver.webp";
import coinForm80WorkoutsSilverGrey from "../../assets/medals/coin_form_80_workouts_silver_grey.webp";
import coinForm90WorkoutsBronze from "../../assets/medals/coin_form_90_workouts_bronze.webp";
import coinForm90WorkoutsBronzeGrey from "../../assets/medals/coin_form_90_workouts_bronze_grey.webp";
import coinForm90WorkoutsGold from "../../assets/medals/coin_form_90_workouts_gold.webp";
import coinForm90WorkoutsGoldGrey from "../../assets/medals/coin_form_90_workouts_gold_grey.webp";
import coinForm90WorkoutsSilver from "../../assets/medals/coin_form_90_workouts_silver.webp";
import coinForm90WorkoutsSilverGrey from "../../assets/medals/coin_form_90_workouts_silver_grey.webp";
import coinKcalBurnedBronze from "../../assets/medals/coin_kcal_burned_bronze.webp";
import coinKcalBurnedBronzeGrey from "../../assets/medals/coin_kcal_burned_bronze_grey.webp";
import coinKcalBurnedGold from "../../assets/medals/coin_kcal_burned_gold.webp";
import coinKcalBurnedGoldGrey from "../../assets/medals/coin_kcal_burned_gold_grey.webp";
import coinKcalBurnedSilver from "../../assets/medals/coin_kcal_burned_silver.webp";
import coinKcalBurnedSilverGrey from "../../assets/medals/coin_kcal_burned_silver_grey.webp";
import coinTrainingDaysBronze from "../../assets/medals/coin_training_days_bronze.webp";
import coinTrainingDaysBronzeGrey from "../../assets/medals/coin_training_days_bronze_grey.webp";
import coinTrainingDaysGold from "../../assets/medals/coin_training_days_gold.webp";
import coinTrainingDaysGoldGrey from "../../assets/medals/coin_training_days_gold_grey.webp";
import coinTrainingDaysSilver from "../../assets/medals/coin_training_days_silver.webp";
import coinTrainingDaysSilverGrey from "../../assets/medals/coin_training_days_silver_grey.webp";
import coinTrainingMinutesBronze from "../../assets/medals/coin_training_minutes_bronze.webp";
import coinTrainingMinutesBronzeGrey from "../../assets/medals/coin_training_minutes_bronze_grey.webp";
import coinTrainingMinutesGold from "../../assets/medals/coin_training_minutes_gold.webp";
import coinTrainingMinutesGoldGrey from "../../assets/medals/coin_training_minutes_gold_grey.webp";
import coinTrainingMinutesSilver from "../../assets/medals/coin_training_minutes_silver.webp";
import coinTrainingMinutesSilverGrey from "../../assets/medals/coin_training_minutes_silver_grey.webp";
import medalCalorie10k from "../../assets/medals/medal_calorie_10k.webp";
import medalCalorie10kLocked from "../../assets/medals/medal_calorie_10k_locked.webp";
import medalCalorie1k from "../../assets/medals/medal_calorie_1k.webp";
import medalCalorie1kLocked from "../../assets/medals/medal_calorie_1k_locked.webp";
import medalEarlyBird from "../../assets/medals/medal_early_bird.webp";
import medalEarlyBirdLocked from "../../assets/medals/medal_early_bird_locked.webp";
import medalFastest10k from "../../assets/medals/medal_fastest_10k.webp";
import medalFastest10kLocked from "../../assets/medals/medal_fastest_10k_locked.webp";
import medalFastest1k from "../../assets/medals/medal_fastest_1k.webp";
import medalFastest1kLocked from "../../assets/medals/medal_fastest_1k_locked.webp";
import medalFastest5k from "../../assets/medals/medal_fastest_5k.webp";
import medalFastest5kLocked from "../../assets/medals/medal_fastest_5k_locked.webp";
import medalLongestRun from "../../assets/medals/medal_longest_run.webp";
import medalLongestRunLocked from "../../assets/medals/medal_longest_run_locked.webp";
import medalFiftyWorkouts from "../../assets/medals/medal_fifty_workouts.webp";
import medalFiftyWorkoutsLocked from "../../assets/medals/medal_fifty_workouts_locked.webp";
import medalFirstMeal from "../../assets/medals/medal_first_meal.webp";
import medalFirstMealLocked from "../../assets/medals/medal_first_meal_locked.webp";
import medalFirstWorkout from "../../assets/medals/medal_first_workout.webp";
import medalFirstWorkoutLocked from "../../assets/medals/medal_first_workout_locked.webp";
import medalFormMaster from "../../assets/medals/medal_form_master.webp";
import medalFormMasterLocked from "../../assets/medals/medal_form_master_locked.webp";
import medalFormPerfect from "../../assets/medals/medal_form_perfect.webp";
import medalFormPerfectLocked from "../../assets/medals/medal_form_perfect_locked.webp";
import medalHundredWorkouts from "../../assets/medals/medal_hundred_workouts.webp";
import medalHundredWorkoutsLocked from "../../assets/medals/medal_hundred_workouts_locked.webp";
import medalMacroMaster from "../../assets/medals/medal_macro_master.webp";
import medalMacroMasterLocked from "../../assets/medals/medal_macro_master_locked.webp";
import medalNightOwl from "../../assets/medals/medal_night_owl.webp";
import medalNightOwlLocked from "../../assets/medals/medal_night_owl_locked.webp";
import medalPhotoMeal from "../../assets/medals/medal_photo_meal.webp";
import medalPhotoMealLocked from "../../assets/medals/medal_photo_meal_locked.webp";
import medalStreak100 from "../../assets/medals/medal_streak_100.webp";
import medalStreak100Locked from "../../assets/medals/medal_streak_100_locked.webp";
import medalStreak3 from "../../assets/medals/medal_streak_3.webp";
import medalStreak30 from "../../assets/medals/medal_streak_30.webp";
import medalStreak30Locked from "../../assets/medals/medal_streak_30_locked.webp";
import medalStreak3Locked from "../../assets/medals/medal_streak_3_locked.webp";
import medalStreak7 from "../../assets/medals/medal_streak_7.webp";
import medalStreak7Locked from "../../assets/medals/medal_streak_7_locked.webp";
import medalTenWorkouts from "../../assets/medals/medal_ten_workouts.webp";
import medalTenWorkoutsLocked from "../../assets/medals/medal_ten_workouts_locked.webp";
import medalVariety5 from "../../assets/medals/medal_variety_5.webp";
import medalVariety5Locked from "../../assets/medals/medal_variety_5_locked.webp";
import medalVarietyAll from "../../assets/medals/medal_variety_all.webp";
import medalVarietyAllLocked from "../../assets/medals/medal_variety_all_locked.webp";
import place1 from "../../assets/medals/place_1.webp";
import place2 from "../../assets/medals/place_2.webp";
import place3 from "../../assets/medals/place_3.webp";

export const medalPictures = {
  coin_families_bronze: coinFamiliesBronze,
  coin_families_bronze_grey: coinFamiliesBronzeGrey,
  coin_families_gold: coinFamiliesGold,
  coin_families_gold_grey: coinFamiliesGoldGrey,
  coin_families_silver: coinFamiliesSilver,
  coin_families_silver_grey: coinFamiliesSilverGrey,
  coin_food_days_bronze: coinFoodDaysBronze,
  coin_food_days_bronze_grey: coinFoodDaysBronzeGrey,
  coin_food_days_gold: coinFoodDaysGold,
  coin_food_days_gold_grey: coinFoodDaysGoldGrey,
  coin_food_days_silver: coinFoodDaysSilver,
  coin_food_days_silver_grey: coinFoodDaysSilverGrey,
  coin_form_80_workouts_bronze: coinForm80WorkoutsBronze,
  coin_form_80_workouts_bronze_grey: coinForm80WorkoutsBronzeGrey,
  coin_form_80_workouts_gold: coinForm80WorkoutsGold,
  coin_form_80_workouts_gold_grey: coinForm80WorkoutsGoldGrey,
  coin_form_80_workouts_silver: coinForm80WorkoutsSilver,
  coin_form_80_workouts_silver_grey: coinForm80WorkoutsSilverGrey,
  coin_form_90_workouts_bronze: coinForm90WorkoutsBronze,
  coin_form_90_workouts_bronze_grey: coinForm90WorkoutsBronzeGrey,
  coin_form_90_workouts_gold: coinForm90WorkoutsGold,
  coin_form_90_workouts_gold_grey: coinForm90WorkoutsGoldGrey,
  coin_form_90_workouts_silver: coinForm90WorkoutsSilver,
  coin_form_90_workouts_silver_grey: coinForm90WorkoutsSilverGrey,
  coin_kcal_burned_bronze: coinKcalBurnedBronze,
  coin_kcal_burned_bronze_grey: coinKcalBurnedBronzeGrey,
  coin_kcal_burned_gold: coinKcalBurnedGold,
  coin_kcal_burned_gold_grey: coinKcalBurnedGoldGrey,
  coin_kcal_burned_silver: coinKcalBurnedSilver,
  coin_kcal_burned_silver_grey: coinKcalBurnedSilverGrey,
  coin_training_days_bronze: coinTrainingDaysBronze,
  coin_training_days_bronze_grey: coinTrainingDaysBronzeGrey,
  coin_training_days_gold: coinTrainingDaysGold,
  coin_training_days_gold_grey: coinTrainingDaysGoldGrey,
  coin_training_days_silver: coinTrainingDaysSilver,
  coin_training_days_silver_grey: coinTrainingDaysSilverGrey,
  coin_training_minutes_bronze: coinTrainingMinutesBronze,
  coin_training_minutes_bronze_grey: coinTrainingMinutesBronzeGrey,
  coin_training_minutes_gold: coinTrainingMinutesGold,
  coin_training_minutes_gold_grey: coinTrainingMinutesGoldGrey,
  coin_training_minutes_silver: coinTrainingMinutesSilver,
  coin_training_minutes_silver_grey: coinTrainingMinutesSilverGrey,
  medal_calorie_10k: medalCalorie10k,
  medal_calorie_10k_locked: medalCalorie10kLocked,
  medal_calorie_1k: medalCalorie1k,
  medal_calorie_1k_locked: medalCalorie1kLocked,
  medal_early_bird: medalEarlyBird,
  medal_early_bird_locked: medalEarlyBirdLocked,
  medal_fastest_10k: medalFastest10k,
  medal_fastest_10k_locked: medalFastest10kLocked,
  medal_fastest_1k: medalFastest1k,
  medal_fastest_1k_locked: medalFastest1kLocked,
  medal_fastest_5k: medalFastest5k,
  medal_fastest_5k_locked: medalFastest5kLocked,
  medal_longest_run: medalLongestRun,
  medal_longest_run_locked: medalLongestRunLocked,
  medal_fifty_workouts: medalFiftyWorkouts,
  medal_fifty_workouts_locked: medalFiftyWorkoutsLocked,
  medal_first_meal: medalFirstMeal,
  medal_first_meal_locked: medalFirstMealLocked,
  medal_first_workout: medalFirstWorkout,
  medal_first_workout_locked: medalFirstWorkoutLocked,
  medal_form_master: medalFormMaster,
  medal_form_master_locked: medalFormMasterLocked,
  medal_form_perfect: medalFormPerfect,
  medal_form_perfect_locked: medalFormPerfectLocked,
  medal_hundred_workouts: medalHundredWorkouts,
  medal_hundred_workouts_locked: medalHundredWorkoutsLocked,
  medal_macro_master: medalMacroMaster,
  medal_macro_master_locked: medalMacroMasterLocked,
  medal_night_owl: medalNightOwl,
  medal_night_owl_locked: medalNightOwlLocked,
  medal_photo_meal: medalPhotoMeal,
  medal_photo_meal_locked: medalPhotoMealLocked,
  medal_streak_100: medalStreak100,
  medal_streak_100_locked: medalStreak100Locked,
  medal_streak_3: medalStreak3,
  medal_streak_30: medalStreak30,
  medal_streak_30_locked: medalStreak30Locked,
  medal_streak_3_locked: medalStreak3Locked,
  medal_streak_7: medalStreak7,
  medal_streak_7_locked: medalStreak7Locked,
  medal_ten_workouts: medalTenWorkouts,
  medal_ten_workouts_locked: medalTenWorkoutsLocked,
  medal_variety_5: medalVariety5,
  medal_variety_5_locked: medalVariety5Locked,
  medal_variety_all: medalVarietyAll,
  medal_variety_all_locked: medalVarietyAllLocked,
  place_1: place1,
  place_2: place2,
  place_3: place3,
} as const;

export type MedalPictureName = keyof typeof medalPictures;

const isMedalName = (name: string): name is MedalPictureName => Object.hasOwn(medalPictures, name);

/** A medal picture by its name, or null where this phone has none by that name. */
export function medalPicture(name: string): (typeof medalPictures)[MedalPictureName] | null {
  return isMedalName(name) ? medalPictures[name] : null;
}
