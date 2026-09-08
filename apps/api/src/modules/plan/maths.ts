// Onboarding v2 — the plan maths and its sanity rules (ROADMAP Stage 1 item 3a;
// RULINGS 2026-09-07 Onboarding and profile).
//
// Pure: no clock (the caller passes "today"), no randomness, no database. Same
// answers in, same numbers out. An answer that is missing yields NO number and a
// list of what is missing (RULINGS 2026-07-15) — never a default.
//
// Where the numbers come from (each a published figure, not one of ours):
//   resting burn   Mifflin-St Jeor (1990), the equation the Academy of Nutrition
//                  and Dietetics' evidence analysis recommends; two formulas exist
//                  (female / male), so "other" and "prefer not to say" take the male one.
//   1 kg = 7 700 kcal   the Wishnofsky planning figure (3 500 kcal a pound). It is
//                  known to run optimistic over long plans because burn falls as
//                  weight falls (Hall, NIH), so every finish date is an estimate.
//   paces          0.25 / 0.5 / 0.75 kg a week, inside the 0.5–1 kg a week the CDC and
//                  the NHS call a safe rate of loss.
//   the 1 200 floor, the protein table, the 25 % fat share and the 50 g carbohydrate
//                  floor are the constants nutrition/targets.ts already used; that file
//                  now reads them from here so the two calculators cannot drift.
//   BMI 18.5       the WHO underweight line.
// Engineering choices of this file, not textbook tables: the no-exercise day
// factors (1.2 is the standard sedentary figure; 1.3 / 1.45 / 1.6 are ours, with
// training added on top at 5 MET), and the ten-year horizon.
import {
  missingPlanInputSchema,
  planInputsSchema,
  planResponseSchema,
  type DayActivity,
  type Gender,
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

/** Calories never go below this (RULINGS 2026-09-07: "the floor already in the code"). */
export const CALORIE_FLOOR_KCAL = 1200;

/** Under this age there is never a calorie-cutting target (RULINGS 2026-09-07). */
export const ADULT_AGE = 18;

/** The lowest healthy weight for a height, as a BMI. */
export const HEALTHY_BMI_FLOOR = 18.5;

/** A plan that takes longer than this is flagged. */
export const ONE_YEAR_DAYS = 365;

/** A target further away than this is out of reach: no finish date is given and
 *  the plan holds the weight instead. Also keeps every finish date inside the
 *  calendar the contract accepts. */
export const MAX_PLAN_DAYS = 10 * ONE_YEAR_DAYS;

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

/** Grams of protein per kilo of body weight, by goal. */
export const PROTEIN_G_PER_KG: Readonly<Record<PlanGoal, number>> = {
  lose: 2.0,
  gain: 2.2,
  maintain: 1.6,
};
/** Fat's share of the calories. */
export const FAT_SHARE = 0.25;
/** Carbohydrates never drop below this; protein gives way first. */
export const CARBS_FLOOR_G = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD plus a whole number of days, in the calendar of the day itself. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Mifflin-St Jeor. Only "female" takes −161; every other answer takes +5. */
export function restingBurn(input: { age: number; gender: Gender; heightCm: number; weightKg: number }): number {
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

export interface Macros {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** The macro split for a day's calories. Fat takes its share; protein asks for
 *  its grams per kilo; carbohydrates take the rest but never less than the floor,
 *  and when the floor bites it is protein that gives way — so the three always
 *  add up to the calories (a heavy body at 2 g/kg would otherwise be handed more
 *  protein and fat than the whole day holds). */
export function macrosFor(kcal: number, weightKg: number, proteinPerKg: number): Macros {
  const fatG = (kcal * FAT_SHARE) / 9;
  const proteinCeilingG = (kcal - CARBS_FLOOR_G * 4 - fatG * 9) / 4;
  const proteinG = Math.min(weightKg * proteinPerKg, proteinCeilingG);
  const carbsG = (kcal - proteinG * 4 - fatG * 9) / 4;
  return { proteinG: Math.round(proteinG), carbsG: Math.round(carbsG), fatG: Math.round(fatG) };
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

/** Calories to eat (whole kcal) for a daily change of `wanted` against a whole
 *  `burn`, never below the floor; `floored` says whether the floor changed it. */
function eatFor(burn: number, wanted: number): { targetKcal: number; floored: boolean } {
  const raw = Math.round(burn + wanted);
  const targetKcal = Math.max(raw, CALORIE_FLOOR_KCAL);
  return { targetKcal, floored: targetKcal !== raw };
}

/** The daily change a pace asks for: negative for a cut, positive for a gain. */
function wantedDailyChange(goal: PlanGoal, pace: PlanPace): number {
  const size = (PACE_KG_PER_WEEK[pace] * KCAL_PER_KG) / 7;
  return goal === "gain" ? size : -size;
}

/** Whole days to move `kgToMove` at `dailyChange` kcal a day (the whole number the
 *  screen shows, so the date can be re-derived from it). Null when the change does
 *  not point the way the goal needs — the floor can turn a cut into nothing or into
 *  a surplus — or when the target is beyond the horizon. */
function daysFor(goal: PlanGoal, kgToMove: number, dailyChange: number): number | null {
  if (goal === "lose" ? dailyChange >= 0 : dailyChange <= 0) return null;
  const days = Math.ceil((kgToMove * KCAL_PER_KG) / Math.abs(dailyChange));
  return days > MAX_PLAN_DAYS ? null : days;
}

export function computePlan(input: PlanInputs): PlanNumbers {
  const bmr = restingBurn(input);
  const burn = Math.round(dailyBurn(input));
  const flags: PlanFlag[] = [];

  // Where the plan runs to. `null` means the weight is not moved.
  let plannedTarget: number | null = null;
  if (input.goal === "lose" && input.targetWeightKg !== null && input.pace !== null) {
    if (input.targetWeightKg >= input.weightKg) {
      flags.push({ code: "target_wrong_direction" });
    } else {
      // One rounded floor, shown and used alike.
      const floorKg = Math.round(healthyWeightFloorKg(input.heightCm) * 10) / 10;
      if (input.targetWeightKg < floorKg) {
        flags.push({ code: "target_below_healthy_weight", floorKg });
        // Already at or under the floor: nothing to lose.
        plannedTarget = floorKg < input.weightKg ? floorKg : null;
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

  let eat = eatFor(burn, plannedTarget !== null && input.pace !== null ? wantedDailyChange(input.goal, input.pace) : 0);
  let days: number | null = null;
  let outOfReach = false;
  let kg = 0;
  if (plannedTarget !== null) {
    kg = Math.abs(plannedTarget - input.weightKg);
    days = daysFor(input.goal, kg, eat.targetKcal - burn);
    if (days === null) {
      // The floor left no cut (a "lose" plan), or the move is beyond the
      // horizon: the plan holds the weight instead of promising a date.
      outOfReach = true;
      plannedTarget = null;
      eat = eatFor(burn, 0);
    }
  }
  if (eat.floored) flags.push({ code: "calorie_floor_applied", floorKcal: CALORIE_FLOOR_KCAL });
  if (days !== null && days > ONE_YEAR_DAYS) {
    const suggested = PACES.find((p) => {
      const alt = daysFor(input.goal, kg, eatFor(burn, wantedDailyChange(input.goal, p)).targetKcal - burn);
      return alt !== null && alt <= ONE_YEAR_DAYS;
    });
    flags.push({ code: "pace_over_a_year", suggestedPace: suggested ?? null });
  }
  if (outOfReach) flags.push({ code: "target_out_of_reach" });

  return {
    restingBurnKcal: Math.round(bmr),
    dailyBurnKcal: burn,
    targetKcal: eat.targetKcal,
    dailyChangeKcal: eat.targetKcal - burn,
    ...macrosFor(eat.targetKcal, input.weightKg, PROTEIN_G_PER_KG[input.goal]),
    plannedTargetKg: plannedTarget ?? input.weightKg,
    daysToTarget: days,
    finishDate: days === null ? null : addDays(input.today, days),
    flags,
  };
}

/** Every calculator input that can be missing: everything but `today` (always
 *  sent) and `health` (an unanswered health screen applies no condition rule yet). */
export const CALCULATOR_INPUTS: readonly string[] = Object.keys(planInputsSchema.shape).filter(
  (k) => k !== "today" && k !== "health",
);

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
    // Unreachable while missingPlanInputs covers every answer read here (the
    // test pins missingPlanInputSchema to CALCULATOR_INPUTS); this is the type
    // bridge, and it fails loud rather than computing from an absence.
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
