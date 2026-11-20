// Calories a minute of an exercise, for the person's own weight (spec Part 2 §13.6, job 63c): the same reckoning
// as a saved workout's (the server's `training/calories.ts`, version 4): MET × weight in kg × hours, with 70 kg
// where the person's weight is not known. A test on the server holds the two together.

/** The weight a workout's calories are reckoned at when the person's own is not known. */
export const KCAL_WEIGHT_UNKNOWN_KG = 70;

/** Whole calories a minute at the exercise's MET, and the weight they were reckoned at. */
export function kcalPerMinute(met: number, weightKg: number | null): { kcal: number; weightKg: number; known: boolean } {
  const known = weightKg !== null && weightKg > 0;
  const kg = known ? weightKg : KCAL_WEIGHT_UNKNOWN_KG;
  return { kcal: Math.round((met * kg) / 60), weightKg: kg, known };
}
