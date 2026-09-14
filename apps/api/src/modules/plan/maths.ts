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
//   protein        grams per kilo, never a share of the calories (Kd, 2026-09-11): a
//                  share would shrink it during a cut, just when it keeps muscle. 2.0
//                  on a loss is the top of the 1.4–2.0 g/kg a day the ISSN's 2017
//                  position stand gives people who train, which asks for more during
//                  a cut; 1.6 to keep the weight sits inside that range; 2.2 to gain
//                  is the top of the 1.6–2.2 g/kg a day Iraki and colleagues' 2019
//                  review gives people who lift while eating more than they burn;
//                  2.2 whatever the weight choice while Build muscle is ticked is what
//                  Morton and colleagues' 2018 meta-analysis of 49 studies recommends
//                  "for those seeking to maximise" the muscle training builds (its
//                  plateau is 1.62 g/kg a day, 95 % CI 1.03 to 2.20). A body heavier
//                  than BMI 30 for its height is counted at its BMI-30 weight
//                  (@app/shared `proteinWeight`; Weijs, 2025).
//   500 kcal a day a cut of about this size stops muscle growing: "an energy deficit
//                  of ~500 kcal · day⁻¹ prevented gains in LM" (Murphy and Koehler's
//                  2022 meta-regression). With Build muscle ticked a larger cut is
//                  flagged, never changed (@app/shared `MUSCLE_GAIN_CUT_LIMIT_KCAL`).
//   the 1 200 floor, the 25 % fat share and the 50 g carbohydrate floor are the
//                  constants of the app's first nutrition calculator, carried over.
//   BMI 18.5       the WHO underweight line; at 16 and 17 the teen figures on the
//                  curve that reaches it at 18 (Cole and colleagues, 2007). One rule
//                  in @app/shared (`healthyWeightFloorKg`), which screen 3 reads to
//                  say a target under it as it is picked (Kd, 2026-09-14).
// Engineering choices of this file, not textbook tables: the no-exercise day
// factors (1.2 is the standard sedentary figure; 1.3 / 1.45 / 1.6 are ours, with
// training added on top at 5 MET), and the ten-year horizon.
//
// Every step the plan screen prints ("How is this worked out?", Kd 2026-09-10)
// is rounded to a whole kcal before the next step reads it, so each sum on that
// screen holds exactly; `workings` on the plan carries those steps.
import {
  ADULT_AGE,
  BUILD_MUSCLE_PROTEIN_G_PER_KG,
  daysToMove,
  HEALTHY_BMI_FLOOR,
  healthyWeightFloorKg,
  KCAL_PER_KG,
  kgBetween,
  MIFFLIN_ST_JEOR_CONSTANT,
  missingPlanInputSchema,
  MUSCLE_GAIN_CUT_LIMIT_KCAL,
  MUSCLE_GAIN_PACE,
  PACE_KG_PER_WEEK,
  paceDailyKcal,
  planInputsSchema,
  planResponseSchema,
  proteinWeight,
  versionFor,
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

/** One kilogram of body weight is about 7 700 kcal — the usual planning figure,
 *  in the shared contract so the pace cards count a pace's cut with it too. */
export { KCAL_PER_KG };

/** Calories never go below this (RULINGS 2026-09-07: "the floor already in the code"). */
export const CALORIE_FLOOR_KCAL = 1200;

/** Under this age there is never a calorie-cutting target (RULINGS 2026-09-07);
 *  in the shared contract so screen 3's pace cards read the same age. */
export { ADULT_AGE };

/** The lowest healthy weight for a height (the adult BMI, and the rule with the
 *  teen figures): the shared rule, so the plan and screen 3 cannot disagree. */
export { HEALTHY_BMI_FLOOR, healthyWeightFloorKg };

/** A plan that takes longer than this is flagged. */
export const ONE_YEAR_DAYS = 365;

/** A target further away than this is out of reach: no finish date is given and
 *  the plan holds the weight instead. Also keeps every finish date inside the
 *  calendar the contract accepts. */
export const MAX_PLAN_DAYS = 10 * ONE_YEAR_DAYS;

/** How fast each pace moves the weight: the shared table, so the screen that
 *  offers the paces and this file cannot disagree. */
export { PACE_KG_PER_WEEK };
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

/** Grams of protein per kilo, by goal (each figure's source is in the header),
 *  of the weight `proteinWeight` counts. */
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

/** Mifflin-St Jeor. Only "female" takes −161; every other answer takes +5
 *  (`versionFor`, the rule the teen healthy weights take too). */
export function restingBurn(input: { age: number; gender: Gender; heightCm: number; weightKg: number }): number {
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + MIFFLIN_ST_JEOR_CONSTANT[versionFor(input.gender)];
}

export interface BurnSteps {
  restingKcal: number;
  dayKcal: number;
  trainingKcal: number;
  burnKcal: number;
}

/** The day's burn in the whole-kcal steps the plan screen prints: resting burn,
 *  rounded; × the day's factor, rounded; plus the week's training spread over
 *  seven days, rounded. The burn IS the sum of the last two. */
export function burnSteps(input: PlanInputs): BurnSteps {
  const restingKcal = Math.round(restingBurn(input));
  const dayKcal = Math.round(restingKcal * DAY_FACTOR[input.dayActivity]);
  const weekHours = (input.sessionMinutes * input.trainingDays) / 60;
  const trainingKcal = Math.round((TRAINING_MET * input.weightKg * weekHours) / 7);
  return { restingKcal, dayKcal, trainingKcal, burnKcal: dayKcal + trainingKcal };
}

export interface Macros {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** The macro split for a day's calories. Fat takes its share; protein asks for
 *  its grams per kilo of the weight it is counted on; carbohydrates take the
 *  rest but never less than the floor, and when the floor bites it is protein
 *  that gives way — so the three always add up to the calories (a tall, heavy
 *  body on a low day would otherwise be handed more protein and fat than the
 *  whole day holds). */
export function macrosFor(kcal: number, proteinWeightKg: number, proteinPerKg: number): Macros {
  const fatG = (kcal * FAT_SHARE) / 9;
  const proteinCeilingG = (kcal - CARBS_FLOOR_G * 4 - fatG * 9) / 4;
  const proteinG = Math.min(proteinWeightKg * proteinPerKg, proteinCeilingG);
  const carbsG = (kcal - proteinG * 4 - fatG * 9) / 4;
  return { proteinG: Math.round(proteinG), carbsG: Math.round(carbsG), fatG: Math.round(fatG) };
}

/** The reasons a cut is refused, in the order the flag lists them. */
export function noDeficitReasons(input: Pick<PlanInputs, "age" | "health">): NoDeficitReason[] {
  const reasons: NoDeficitReason[] = [];
  if (input.age < ADULT_AGE) reasons.push("under_18");
  // One general question (Kd, 2026-09-09): any yes refuses the cut, cleared or
  // not, because the app never learns what the yes is. Safe mode is a yes plus
  // "not yet", listed as well so the screen can say both.
  if (input.health?.hasCondition) reasons.push("health_answer");
  if (input.health?.safeMode) reasons.push("safe_mode");
  return reasons;
}

/** Calories to eat for a whole daily `change` against a whole `burn`, never
 *  below the floor; `floored` says whether the floor changed it. */
function eatFor(burn: number, change: number): { targetKcal: number; floored: boolean } {
  const raw = burn + change;
  const targetKcal = Math.max(raw, CALORIE_FLOOR_KCAL);
  return { targetKcal, floored: targetKcal !== raw };
}

/** The whole daily change a pace asks for: negative for a cut, positive for a gain. */
function wantedDailyChange(goal: PlanGoal, pace: PlanPace): number {
  const size = paceDailyKcal(pace);
  return goal === "gain" ? size : -size;
}

/** Whole days to move `kgToMove` at `dailyChange` kcal a day — the whole number
 *  the screen shows, re-derivable from it (`daysToMove`, in whole hundredths of
 *  a kilo). Null when the change does not point the way the goal needs — the
 *  floor can turn a cut into nothing or into a surplus — or when the target is
 *  beyond the horizon. */
function daysFor(goal: PlanGoal, kgToMove: number, dailyChange: number): number | null {
  if (goal === "lose" ? dailyChange >= 0 : dailyChange <= 0) return null;
  const days = daysToMove(kgToMove, KCAL_PER_KG, dailyChange);
  return days > MAX_PLAN_DAYS ? null : days;
}

/** The plan for these answers, and what each pace would change a day with every
 *  other answer the same: the same maths run at each pace, so screen 3's
 *  building-muscle mark and the plan cannot disagree. */
export function computePlan(input: PlanInputs): PlanNumbers {
  const changeAt = (pace: PlanPace): number => planAt({ ...input, pace }).dailyChangeKcal;
  const dailyChangeKcalByPace =
    input.goal === "maintain" || input.targetWeightKg === null
      ? null
      : { gentle: changeAt("gentle"), steady: changeAt("steady"), brisk: changeAt("brisk") };
  // In the contract's order, so the plan reads the same before and after parsing.
  const { restingBurnKcal, dailyBurnKcal, targetKcal, dailyChangeKcal, ...rest } = planAt(input);
  return { restingBurnKcal, dailyBurnKcal, targetKcal, dailyChangeKcal, dailyChangeKcalByPace, ...rest };
}

function planAt(input: PlanInputs): Omit<PlanNumbers, "dailyChangeKcalByPace"> {
  const steps = burnSteps(input);
  const burn = steps.burnKcal;
  const flags: PlanFlag[] = [];

  // Where the plan runs to. `null` means the weight is not moved.
  let plannedTarget: number | null = null;
  if (input.goal === "lose" && input.targetWeightKg !== null && input.pace !== null) {
    if (input.targetWeightKg >= input.weightKg) {
      flags.push({ code: "target_wrong_direction" });
    } else {
      // One rounded floor, shown and used alike, for this height, age and version.
      const floorKg = healthyWeightFloorKg(input.heightCm, input.age, versionFor(input.gender));
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

  // The daily change the pace asks for; nothing while the weight is not moved.
  let change = plannedTarget !== null && input.pace !== null ? wantedDailyChange(input.goal, input.pace) : 0;
  let eat = eatFor(burn, change);
  let days: number | null = null;
  let outOfReach = false;
  let kg = 0;
  if (plannedTarget !== null) {
    kg = kgBetween(plannedTarget, input.weightKg);
    days = daysFor(input.goal, kg, eat.targetKcal - burn);
    if (days === null) {
      // The floor left no cut (a "lose" plan), or the move is beyond the
      // horizon: the plan holds the weight instead of promising a date.
      outOfReach = true;
      plannedTarget = null;
      change = 0;
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
  // Building muscle while losing weight (Kd, 2026-09-13: tell them): a cut over
  // the limit is said, with the pace that cuts less, and the calories stay the
  // weight choice's. The cut is the one eaten, after the floor.
  if (input.buildMuscle && burn - eat.targetKcal > MUSCLE_GAIN_CUT_LIMIT_KCAL) {
    flags.push({ code: "cut_limits_muscle_gain", limitKcal: MUSCLE_GAIN_CUT_LIMIT_KCAL, suggestedPace: MUSCLE_GAIN_PACE });
  }

  // Build muscle ticked raises protein, whatever the weight choice, and moves
  // no calorie (RULINGS 2026-09-11: building muscle is not gaining weight).
  const proteinPerKg = input.buildMuscle
    ? Math.max(PROTEIN_G_PER_KG[input.goal], BUILD_MUSCLE_PROTEIN_G_PER_KG)
    : PROTEIN_G_PER_KG[input.goal];
  const protein = proteinWeight(input.weightKg, input.heightCm);
  const formula = versionFor(input.gender);
  return {
    restingBurnKcal: steps.restingKcal,
    dailyBurnKcal: burn,
    targetKcal: eat.targetKcal,
    dailyChangeKcal: eat.targetKcal - burn,
    ...macrosFor(eat.targetKcal, protein.kg, proteinPerKg),
    plannedTargetKg: plannedTarget ?? input.weightKg,
    daysToTarget: days,
    finishDate: days === null ? null : addDays(input.today, days),
    flags,
    workings: {
      resting: {
        formula,
        weightKg: input.weightKg,
        heightCm: input.heightCm,
        age: input.age,
        constant: MIFFLIN_ST_JEOR_CONSTANT[formula],
        kcal: steps.restingKcal,
      },
      day: { activity: input.dayActivity, factor: DAY_FACTOR[input.dayActivity], kcal: steps.dayKcal },
      training: {
        kcalPerKgHour: TRAINING_MET,
        weightKg: input.weightKg,
        trainingDays: input.trainingDays,
        sessionMinutes: input.sessionMinutes,
        kcal: steps.trainingKcal,
      },
      change:
        change === 0 || input.pace === null
          ? null
          : { pace: input.pace, kgPerWeek: PACE_KG_PER_WEEK[input.pace], kcalPerKg: KCAL_PER_KG, kcal: change },
      beforeFloorKcal: burn + change,
      floorKcal: CALORIE_FLOOR_KCAL,
      protein: {
        gPerKg: proteinPerKg,
        weightKg: protein.kg,
        referenceBmi: protein.referenceBmi,
        wantedG: Math.round(protein.kg * proteinPerKg),
        buildMuscle: input.buildMuscle,
      },
      fatShare: FAT_SHARE,
      carbsFloorG: CARBS_FLOOR_G,
      finish: days === null ? null : { kgToMove: kg, kcalPerKg: KCAL_PER_KG },
    },
  };
}

/** Every calculator input that can be missing: everything but `today` (always
 *  sent), `health` (an unanswered health screen applies no condition rule yet)
 *  and `buildMuscle` (a goal left unticked is an answer, not a gap). */
export const CALCULATOR_INPUTS: readonly string[] = Object.keys(planInputsSchema.shape).filter(
  (k) => k !== "today" && k !== "health" && k !== "buildMuscle",
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
      // Nothing ticked is an answer too: no Build muscle, no raise.
      buildMuscle: answers.buildMuscle ?? false,
      today: answers.today,
    }),
    missing,
  };
}
