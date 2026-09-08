// Onboarding v2 — the plan maths and its sanity rules (ROADMAP Stage 1 item 3a;
// RULINGS 2026-09-07 Onboarding and profile).
//
// Pure: no clock (the caller passes "today"), no randomness, no database. Same
// answers in, same numbers out. An answer that is missing yields NO number and a
// list of what is missing (RULINGS 2026-07-15) — never a default.
//
// The constants that already existed in the code are reused, not re-derived:
// resting burn, the 1200 kcal floor, the protein grams per kilo, the 25 % fat
// share and the 50 g carbohydrate floor all come from nutrition/targets.ts.
import {
  missingPlanInputSchema,
  planResponseSchema,
  type DayActivity,
  type MissingPlanInput,
  type NoDeficitReason,
  type PlanAnswers,
  type PlanFlag,
  type PlanGoal,
  type PlanInputs,
  type PlanNumbers,
  type PlanPace,
  type PlanResponse,
} from "@app/shared";

/** One kilogram of body weight is about 7 700 kcal — the usual planning figure. */
export const KCAL_PER_KG = 7700;

/** The floor already in the code (nutrition/targets.ts:167). Calories never go below it. */
export const CALORIE_FLOOR_KCAL = 1200;

/** Under this age there is never a calorie-cutting target (RULINGS 2026-09-07). */
export const ADULT_AGE = 18;

/** The lowest healthy weight for a height, as a BMI. */
export const HEALTHY_BMI_FLOOR = 18.5;

/** A plan that takes longer than this is flagged. */
export const ONE_YEAR_DAYS = 365;

/** How fast each pace moves the weight. The same table serves losing and gaining. */
export const PACE_KG_PER_WEEK: Readonly<Record<PlanPace, number>> = {
  gentle: 0.25,
  steady: 0.5,
  brisk: 0.75,
};
const PACES: readonly PlanPace[] = ["gentle", "steady", "brisk"];

/** Resting burn × this = the day's burn WITHOUT training (training is added from
 *  the week's answers, so these are the no-exercise factors, not the usual
 *  exercise-inclusive ones). */
export const DAY_FACTOR: Readonly<Record<DayActivity, number>> = {
  sitting: 1.2,
  on_feet: 1.3,
  active: 1.45,
  very_active: 1.6,
};

/** A training session burns MET × kg × hours; 5 is moderate calisthenics. */
export const TRAINING_MET = 5;

/** Grams of protein per kilo of body weight, by goal (nutrition/targets.ts:174). */
export const PROTEIN_G_PER_KG: Readonly<Record<PlanGoal, number>> = {
  lose: 2.0,
  gain: 2.2,
  maintain: 1.6,
};
const FAT_SHARE = 0.25; // targets.ts:176
const CARBS_FLOOR_G = 50; // targets.ts:184

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD plus a whole number of days, in the calendar of the day itself. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function restingBurn(input: Pick<PlanInputs, "age" | "gender" | "heightCm" | "weightKg">): number {
  // Mifflin-St Jeor, as nutrition/targets.ts:156: only "female" takes −161.
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.gender === "female" ? -161 : 5);
}

export function dailyBurn(input: PlanInputs): number {
  const perSession = TRAINING_MET * input.weightKg * (input.sessionMinutes / 60);
  return restingBurn(input) * DAY_FACTOR[input.dayActivity] + (perSession * input.trainingDays) / 7;
}

export function healthyWeightFloorKg(heightCm: number): number {
  const m = heightCm / 100;
  return HEALTHY_BMI_FLOOR * m * m;
}

/** The reasons a cut is refused, in the order the flag lists them. */
export function noDeficitReasons(input: Pick<PlanInputs, "age" | "health">): NoDeficitReason[] {
  const reasons: NoDeficitReason[] = [];
  if (input.age < ADULT_AGE) reasons.push("under_18");
  if (input.health?.pregnant) reasons.push("pregnancy");
  if (input.health?.heart) reasons.push("heart");
  if (input.health?.bloodPressure) reasons.push("blood_pressure");
  if (input.health?.diabetes) reasons.push("diabetes");
  return reasons;
}

/** Calories to eat for a daily change of `wanted` kcal against `burn`, never
 *  below the floor; `floored` says whether the floor changed the answer. */
function eatFor(burn: number, wanted: number): { targetKcal: number; floored: boolean } {
  const raw = burn + wanted;
  const targetKcal = Math.max(raw, CALORIE_FLOOR_KCAL);
  return { targetKcal, floored: targetKcal !== raw };
}

/** The daily change a pace asks for: negative for a cut, positive for a gain. */
function wantedDailyChange(goal: PlanGoal, pace: PlanPace): number {
  const size = (PACE_KG_PER_WEEK[pace] * KCAL_PER_KG) / 7;
  return goal === "gain" ? size : -size;
}

/** Whole days to move `kgToMove` at `dailyChange` kcal a day; null when the
 *  change does not point the way the goal needs (the floor can turn a cut into
 *  a surplus). */
function daysFor(goal: PlanGoal, kgToMove: number, dailyChange: number): number | null {
  if (goal === "lose" ? dailyChange >= 0 : dailyChange <= 0) return null;
  return Math.ceil((kgToMove * KCAL_PER_KG) / Math.abs(dailyChange));
}

export function computePlan(input: PlanInputs): PlanNumbers {
  const bmr = restingBurn(input);
  const burn = dailyBurn(input);
  const flags: PlanFlag[] = [];

  // Where the plan runs to. `null` means the weight is not moved.
  let plannedTarget: number | null = null;
  if (input.goal === "lose" && input.targetWeightKg !== null && input.pace !== null) {
    if (input.targetWeightKg >= input.weightKg) {
      flags.push({ code: "target_wrong_direction" });
    } else {
      const floor = healthyWeightFloorKg(input.heightCm);
      if (input.targetWeightKg < floor) {
        flags.push({ code: "target_below_healthy_weight", floorKg: Math.round(floor * 10) / 10 });
        // Already at or under the floor: nothing to lose.
        plannedTarget = floor < input.weightKg ? floor : null;
      } else {
        plannedTarget = input.targetWeightKg;
      }
    }
    if (plannedTarget !== null) {
      const reasons = noDeficitReasons(input);
      if (reasons.length > 0) {
        flags.push({ code: "no_deficit", reasons });
        plannedTarget = null;
      }
    }
  } else if (input.goal === "gain" && input.targetWeightKg !== null && input.pace !== null) {
    if (input.targetWeightKg <= input.weightKg) flags.push({ code: "target_wrong_direction" });
    else plannedTarget = input.targetWeightKg;
  }

  const wanted = plannedTarget !== null && input.pace !== null ? wantedDailyChange(input.goal, input.pace) : 0;
  const { targetKcal, floored } = eatFor(burn, wanted);
  if (floored) flags.push({ code: "calorie_floor_applied", floorKcal: CALORIE_FLOOR_KCAL });
  const change = targetKcal - burn;

  let days: number | null = null;
  if (plannedTarget !== null) {
    const kg = Math.abs(plannedTarget - input.weightKg);
    days = daysFor(input.goal, kg, change);
    if (days !== null && days > ONE_YEAR_DAYS) {
      const suggested = PACES.find((p) => {
        const alt = daysFor(input.goal, kg, eatFor(burn, wantedDailyChange(input.goal, p)).targetKcal - burn);
        return alt !== null && alt <= ONE_YEAR_DAYS;
      });
      flags.push({ code: "pace_over_a_year", suggestedPace: suggested ?? null });
    }
    // The floor left no cut at all: the plan cannot move the weight.
    if (days === null) plannedTarget = null;
  }

  const proteinG = input.weightKg * PROTEIN_G_PER_KG[input.goal];
  const fatG = (targetKcal * FAT_SHARE) / 9;
  const carbsG = Math.max((targetKcal - proteinG * 4 - fatG * 9) / 4, CARBS_FLOOR_G);

  return {
    restingBurnKcal: Math.round(bmr),
    dailyBurnKcal: Math.round(burn),
    targetKcal: Math.round(targetKcal),
    dailyChangeKcal: Math.round(change),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
    plannedTargetKg: plannedTarget ?? input.weightKg,
    daysToTarget: days,
    finishDate: days === null ? null : addDays(input.today, days),
    flags,
  };
}

/** Which answers are still needed. The target and pace are asked only once the
 *  goal is known to need them; "maintain" needs neither. */
export function missingPlanInputs(answers: PlanAnswers): MissingPlanInput[] {
  const needsTarget = answers.goal === "lose" || answers.goal === "gain";
  const present: Record<MissingPlanInput, boolean> = {
    goal: answers.goal != null,
    age: answers.age != null,
    gender: answers.gender != null,
    heightCm: answers.heightCm != null,
    weightKg: answers.weightKg != null,
    targetWeightKg: !needsTarget || answers.targetWeightKg != null,
    pace: !needsTarget || answers.pace != null,
    dayActivity: answers.dayActivity != null,
    trainingDays: answers.trainingDays != null,
    sessionMinutes: answers.sessionMinutes != null,
  };
  return missingPlanInputSchema.options.filter((k) => !present[k]);
}

/** The one entry point: the numbers, or an honest account of what is missing.
 *  Never both — enforced by parsing through the shared contract. */
export function resolvePlan(answers: PlanAnswers): PlanResponse {
  return planResponseSchema.parse(resolvePlanUnchecked(answers));
}

function resolvePlanUnchecked(answers: PlanAnswers): PlanResponse {
  const missing = missingPlanInputs(answers);
  if (missing.length > 0) return { plan: null, missing };

  const { goal, age, gender, heightCm, weightKg, dayActivity, trainingDays, sessionMinutes } = answers;
  if (
    goal === undefined ||
    age === undefined ||
    gender === undefined ||
    heightCm === undefined ||
    weightKg === undefined ||
    dayActivity === undefined ||
    trainingDays === undefined ||
    sessionMinutes === undefined
  ) {
    // Unreachable while missingPlanInputs covers every answer read here; this is
    // the type bridge, and it fails loud rather than computing from an absence.
    throw new Error("plan: missingPlanInputs does not cover every calculator input");
  }
  return {
    plan: computePlan({
      goal,
      age,
      gender,
      heightCm,
      weightKg,
      targetWeightKg: answers.targetWeightKg ?? null,
      pace: answers.pace ?? null,
      dayActivity,
      trainingDays,
      sessionMinutes,
      health: answers.health ?? null,
      today: answers.today,
    }),
    missing,
  };
}
