// A painting for each badge's and each kind of challenge's box (Kd, 2026-11-05: a different ancient one
// each, no cycling), from his Greek, Viking, Egyptian and Cave posters, cut 800 x 400 without their words or
// made-up numbers by docs/design/phone/medals/bands.py. A challenge's is `c_` and its measure.
import type { ImageSourcePropType } from "react-native";
import band_c_families from "../../assets/bands/c_families.webp";
import band_c_food_days from "../../assets/bands/c_food_days.webp";
import band_c_form_80_workouts from "../../assets/bands/c_form_80_workouts.webp";
import band_c_form_90_workouts from "../../assets/bands/c_form_90_workouts.webp";
import band_c_kcal_burned from "../../assets/bands/c_kcal_burned.webp";
import band_c_training_days from "../../assets/bands/c_training_days.webp";
import band_c_training_minutes from "../../assets/bands/c_training_minutes.webp";
import band_calorie_10k from "../../assets/bands/calorie_10k.webp";
import band_calorie_1k from "../../assets/bands/calorie_1k.webp";
import band_early_bird from "../../assets/bands/early_bird.webp";
import band_fifty_workouts from "../../assets/bands/fifty_workouts.webp";
import band_first_meal from "../../assets/bands/first_meal.webp";
import band_first_workout from "../../assets/bands/first_workout.webp";
import band_form_master from "../../assets/bands/form_master.webp";
import band_form_perfect from "../../assets/bands/form_perfect.webp";
import band_hundred_workouts from "../../assets/bands/hundred_workouts.webp";
import band_macro_master from "../../assets/bands/macro_master.webp";
import band_night_owl from "../../assets/bands/night_owl.webp";
import band_photo_meal from "../../assets/bands/photo_meal.webp";
import band_streak_100 from "../../assets/bands/streak_100.webp";
import band_streak_3 from "../../assets/bands/streak_3.webp";
import band_streak_30 from "../../assets/bands/streak_30.webp";
import band_streak_7 from "../../assets/bands/streak_7.webp";
import band_ten_workouts from "../../assets/bands/ten_workouts.webp";
import band_variety_5 from "../../assets/bands/variety_5.webp";
import band_variety_all from "../../assets/bands/variety_all.webp";

const BANDS: Readonly<Record<string, ImageSourcePropType>> = {
  c_families: band_c_families,
  c_food_days: band_c_food_days,
  c_form_80_workouts: band_c_form_80_workouts,
  c_form_90_workouts: band_c_form_90_workouts,
  c_kcal_burned: band_c_kcal_burned,
  c_training_days: band_c_training_days,
  c_training_minutes: band_c_training_minutes,
  calorie_10k: band_calorie_10k,
  calorie_1k: band_calorie_1k,
  early_bird: band_early_bird,
  fifty_workouts: band_fifty_workouts,
  first_meal: band_first_meal,
  first_workout: band_first_workout,
  form_master: band_form_master,
  form_perfect: band_form_perfect,
  hundred_workouts: band_hundred_workouts,
  macro_master: band_macro_master,
  night_owl: band_night_owl,
  photo_meal: band_photo_meal,
  streak_100: band_streak_100,
  streak_3: band_streak_3,
  streak_30: band_streak_30,
  streak_7: band_streak_7,
  ten_workouts: band_ten_workouts,
  variety_5: band_variety_5,
  variety_all: band_variety_all,
};

/** The painting for a badge (its code) or a challenge (`c_` and its measure), or null where there is none. */
export function bandFor(key: string): ImageSourcePropType | null {
  return Object.hasOwn(BANDS, key) ? (BANDS[key] ?? null) : null;
}
