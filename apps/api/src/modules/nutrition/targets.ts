// The macro rings' numbers (GET /v1/nutrition/targets). Since ROADMAP Stage 1
// item 4a-iii they ARE the plan's: the same stored answers, the same calculator
// (plan/maths.ts) and the same function (users/service getUserPlan) as the
// onboarding screens' "your daily number", so the app can never show two daily
// numbers. This file only reshapes a plan into the rings' contract.
//
// The first calculator here — a port of the old nutrition.py that read the
// profile's days a week as an activity factor and cut a fixed 400 kcal (or
// added 300) — is retired with that move. Its resting burn, calorie floor and
// macro split were already the plan calculator's.
import { nutritionTargetsResponseSchema, type NutritionTargetsResponse, type PlanResponse } from "./schemas.js";

/** The plan as the rings' numbers, or the plan's own list of what is still
 *  missing. Parsed through the shared contract, so "a number exactly when
 *  nothing is missing" holds for every caller. */
export function targetsFromPlan(result: PlanResponse): NutritionTargetsResponse {
  const plan = result.plan;
  return nutritionTargetsResponseSchema.parse({
    targets:
      plan === null
        ? null
        : {
            bmr: plan.restingBurnKcal,
            tdee: plan.dailyBurnKcal,
            kcal: plan.targetKcal,
            proteinG: plan.proteinG,
            carbsG: plan.carbsG,
            fatG: plan.fatG,
            noCalorieCut: plan.flags.some((f) => f.code === "no_deficit"),
          },
    missing: result.missing,
  });
}
