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
 *  nothing is missing" holds for every caller.
 *
 *  A target on the wrong side of the weight (a loss target kept when the goal
 *  changed to Muscle Gain in Settings, or a weight that moved past its target)
 *  leaves the plan holding the weight. The rings do not pass that off as the
 *  goal's number: they ask for the target, and "Answer now" opens the target
 *  screen, which names the old one and offers only the goal's side (RULINGS
 *  2026-09-11). */
export function targetsFromPlan(result: PlanResponse): NutritionTargetsResponse {
  const plan = result.plan;
  const wrongSide = plan !== null && plan.flags.some((f) => f.code === "target_wrong_direction");
  return nutritionTargetsResponseSchema.parse({
    targets:
      plan === null || wrongSide
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
    missing: wrongSide ? ["targetWeightKg"] : result.missing,
  });
}
