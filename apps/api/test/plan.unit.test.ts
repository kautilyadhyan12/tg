import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILD_MUSCLE_PROTEIN_G_PER_KG,
  calendarDaySchema,
  daysToMove,
  MIFFLIN_ST_JEOR_CONSTANT,
  missingPlanInputSchema,
  MUSCLE_GAIN_CUT_LIMIT_KCAL,
  MUSCLE_GAIN_PACE,
  paceDailyKcal,
  planAnswersSchema,
  planHealthSchema,
  planInputsSchema,
  planNumbersSchema,
  planResponseSchema,
  planStartDaySchema,
  PROTEIN_REFERENCE_BMI,
  proteinWeight,
  type PlanAnswers,
  type PlanInputs,
} from "@app/shared";
import {
  ADULT_AGE,
  CALCULATOR_INPUTS,
  CALORIE_FLOOR_KCAL,
  CARBS_FLOOR_G,
  DAY_FACTOR,
  FAT_SHARE,
  HEALTHY_BMI_FLOOR,
  KCAL_PER_KG,
  MAX_PLAN_DAYS,
  ONE_YEAR_DAYS,
  PACE_KG_PER_WEEK,
  PROTEIN_G_PER_KG,
  TRAINING_MET,
  addDays,
  burnSteps,
  computePlan,
  healthyWeightFloorKg,
  macrosFor,
  missingPlanInputs,
  noDeficitReasons,
  resolvePlan,
  restingBurn,
} from "../src/modules/plan/maths.js";

// The worked example every golden below is hand-computed from, in the whole-kcal
// steps the plan screen prints ("How is this worked out?"):
//   resting burn  = 10·82 + 6.25·175 − 5·30 + 5            = 1768.75 → 1769
//   your day      = 1769 · 1.2 (sitting)                   = 2122.8  → 2123
//   training      = 5 · 82 kg · (3 · 45 min) ÷ 60 ÷ 7      = 131.79  → 132
//   daily burn    = 2123 + 132                             = 2255
//   steady cut    = 0.5 kg/wk · 7700 / 7                   = 550 a day
//   eat           = 2255 − 550                             = 1705
//   days          = ⌈7 kg · 7700 / 550⌉                    = 98 → 2026-12-15
//   protein 82·2 = 164 · fat 1705·0.25/9 = 47.36 → 47 · carbs (1705 − 656 − 426.25)/4 = 155.69 → 156
/** The facts every plan must hold, whatever the body: the screen's numbers
 *  subtract and add up, the floors hold, the date is re-derivable from what is
 *  shown, an unmoved plan holds the current weight (and says why), and the
 *  contract accepts it. Returns the broken facts, in words, so a sweep of
 *  thousands of bodies costs no `expect` per fact. */
function brokenFacts(body: PlanInputs): string[] {
  const broken: string[] = [];
  const check = (fact: string, holds: boolean) => { if (!holds) broken.push(fact); };
  const r = resolvePlan(body);
  check("nothing missing", r.missing.length === 0);
  const plan = r.plan;
  if (plan === null) return ["no plan"];
  check("resolvePlan is computePlan", JSON.stringify(plan) === JSON.stringify(computePlan(body)));
  check("change = eat − burn", plan.targetKcal - plan.dailyBurnKcal === plan.dailyChangeKcal);
  check("calorie floor", plan.targetKcal >= CALORIE_FLOOR_KCAL);
  check("grams make the calories", Math.abs(plan.proteinG * 4 + plan.carbsG * 4 + plan.fatG * 9 - plan.targetKcal) <= 9);
  check("carb floor", plan.carbsG >= CARBS_FLOOR_G);
  check("protein not negative", plan.proteinG >= 0);
  check("date exactly when days", (plan.finishDate === null) === (plan.daysToTarget === null));
  const codes = plan.flags.map((f) => f.code);
  check("no flag twice", new Set(codes).size === codes.length);
  // The working "How is this worked out?" prints: every line holds on its own
  // numbers, and its sums hold on the plan's.
  const w = plan.workings;
  const rest = w.resting;
  const train = w.training;
  check("working: resting is the equation", rest.kcal === Math.round(10 * rest.weightKg + 6.25 * rest.heightCm - 5 * rest.age + rest.constant));
  check("working: day is resting × factor", w.day.kcal === Math.round(rest.kcal * w.day.factor));
  check("working: training is its product", train.kcal === Math.round((train.kcalPerKgHour * train.weightKg * ((train.sessionMinutes * train.trainingDays) / 60)) / 7));
  check("working: burn is day + training", w.day.kcal + train.kcal === plan.dailyBurnKcal);
  check("working: the change is the pace's", w.change === null || Math.abs(w.change.kcal) === Math.round((w.change.kgPerWeek * w.change.kcalPerKg) / 7));
  check("working: a change exactly when the weight moves", (w.change === null) === (plan.daysToTarget === null));
  check("working: eat is burn + change, floored", w.beforeFloorKcal === plan.dailyBurnKcal + (w.change?.kcal ?? 0) && plan.targetKcal === Math.max(w.beforeFloorKcal, w.floorKcal));
  check("working: protein asked is the table's", w.protein.wantedG === Math.round(w.protein.weightKg * w.protein.gPerKg) && plan.proteinG <= w.protein.wantedG);
  check(
    "working: protein is the weight choice's figure, raised to Build muscle's while it is ticked",
    w.protein.buildMuscle === body.buildMuscle &&
      w.protein.gPerKg ===
        (body.buildMuscle ? Math.max(PROTEIN_G_PER_KG[body.goal], BUILD_MUSCLE_PROTEIN_G_PER_KG) : PROTEIN_G_PER_KG[body.goal]),
  );
  // Restated here, not called: the body's weight, or its BMI-30 weight when it is heavier.
  const m = body.heightCm / 100;
  const bmi30Kg = Math.round(30 * m * m * 100) / 100;
  check(
    "working: protein is counted on the weight, never past BMI 30 for the height",
    w.protein.weightKg === Math.min(body.weightKg, bmi30Kg) && w.protein.referenceBmi === (body.weightKg > bmi30Kg ? 30 : null),
  );
  check("the contract accepts it", planNumbersSchema.safeParse(plan).success);
  if (plan.daysToTarget !== null) {
    check("inside the horizon", plan.daysToTarget <= MAX_PLAN_DAYS);
    check("days re-derivable", plan.daysToTarget === daysToMove(Math.abs(plan.plannedTargetKg - body.weightKg), KCAL_PER_KG, plan.dailyChangeKcal));
    check("date = today + days", plan.finishDate === addDays(body.today, plan.daysToTarget));
    check("a dated plan is not out of reach", !codes.includes("target_out_of_reach"));
    check("a dated plan has a deficit allowed", !codes.includes("no_deficit"));
    if (plan.daysToTarget > ONE_YEAR_DAYS) check("over a year is flagged", codes.includes("pace_over_a_year"));
    const over = plan.flags.find((f) => f.code === "pace_over_a_year");
    if (over?.suggestedPace) {
      const faster = computePlan({ ...body, pace: over.suggestedPace }).daysToTarget;
      check("the suggested pace finishes inside a year", faster !== null && faster <= ONE_YEAR_DAYS);
    }
  } else {
    check("an unmoved plan holds the weight", plan.plannedTargetKg === body.weightKg);
    check("an unmoved plan eats its burn unless floored", plan.dailyChangeKcal === 0 || codes.includes("calorie_floor_applied"));
    check("an unmoved plan says why", body.goal === "maintain" || codes.some((c) => c !== "calorie_floor_applied" && c !== "pace_over_a_year"));
  }
  if (plan.dailyChangeKcal < 0) check("a cut is never under no_deficit", !codes.includes("no_deficit"));
  // Restated, not called: the muscle line exactly when Build muscle is ticked and
  // the cut eaten is over the limit, and its pace cuts within it on this body.
  check(
    "the muscle line exactly when Build muscle is ticked and the cut is over the limit",
    codes.includes("cut_limits_muscle_gain") === (body.buildMuscle && plan.dailyBurnKcal - plan.targetKcal > 500),
  );
  const muscle = plan.flags.find((f) => f.code === "cut_limits_muscle_gain");
  if (muscle?.suggestedPace) {
    const slower = computePlan({ ...body, pace: muscle.suggestedPace });
    check("the muscle line's pace cuts within the limit", slower.dailyBurnKcal - slower.targetKcal <= 500);
  }
  return broken;
}

function expectSanePlan(body: PlanInputs): void {
  expect(brokenFacts(body), JSON.stringify(body)).toEqual([]);
}

const sample: PlanInputs = {
  goal: "lose",
  age: 30,
  gender: "male",
  heightCm: 175,
  weightKg: 82,
  targetWeightKg: 75,
  pace: "steady",
  dayActivity: "sitting",
  trainingDays: 3,
  sessionMinutes: 45,
  health: { hasCondition: false, safeMode: false },
  buildMuscle: false,
  today: "2026-09-08",
};

describe("plan maths — the numbers (Stage 1 item 3a)", () => {
  it("pins the tables the numbers come from", () => {
    expect(KCAL_PER_KG).toBe(7700);
    expect(CALORIE_FLOOR_KCAL).toBe(1200); // "the floor already in the code" (RULINGS 2026-09-07)
    expect(ADULT_AGE).toBe(18);
    expect(HEALTHY_BMI_FLOOR).toBe(18.5);
    expect(ONE_YEAR_DAYS).toBe(365);
    expect(MAX_PLAN_DAYS).toBe(3650);
    expect(TRAINING_MET).toBe(5);
    expect(FAT_SHARE).toBe(0.25);
    expect(CARBS_FLOOR_G).toBe(50);
    expect(PACE_KG_PER_WEEK).toEqual({ gentle: 0.25, steady: 0.5, brisk: 0.75 });
    expect(DAY_FACTOR).toEqual({ sitting: 1.2, on_feet: 1.3, active: 1.45, very_active: 1.6 });
    expect(PROTEIN_G_PER_KG).toEqual({ lose: 2.0, gain: 2.2, maintain: 1.6 }); // grams per kilo, never a share (Kd, 2026-09-11)
    expect(BUILD_MUSCLE_PROTEIN_G_PER_KG).toBe(2.2); // Morton and colleagues, 2018: "~2.2 g protein/kg/d" to maximise
    expect(PROTEIN_REFERENCE_BMI).toBe(30);
    expect(MIFFLIN_ST_JEOR_CONSTANT).toEqual({ female: -161, male: 5 });
    // Murphy and Koehler, 2022: "an energy deficit of ~500 kcal · day⁻¹ prevented gains in LM".
    expect(MUSCLE_GAIN_CUT_LIMIT_KCAL).toBe(500);
    expect({ gentle: paceDailyKcal("gentle"), steady: paceDailyKcal("steady"), brisk: paceDailyKcal("brisk") }).toEqual({
      gentle: 275,
      steady: 550,
      brisk: 825,
    });
    expect(MUSCLE_GAIN_PACE).toBe("gentle");
  });

  it("resting burn is Mifflin-St Jeor; only 'female' takes −161", () => {
    expect(restingBurn(sample)).toBeCloseTo(1768.75, 6);
    expect(restingBurn({ ...sample, gender: "female" })).toBeCloseTo(1768.75 - 166, 6);
    expect(restingBurn({ ...sample, gender: "other" })).toBeCloseTo(1768.75, 6);
    expect(restingBurn({ ...sample, gender: "prefer_not_to_say" })).toBeCloseTo(1768.75, 6);
  });

  it("daily burn = resting × the day's factor + the week's training over 7 days, each step in whole kcal", () => {
    expect(burnSteps(sample)).toEqual({ restingKcal: 1769, dayKcal: 2123, trainingKcal: 132, burnKcal: 2255 });
    // No training: the day's factor alone.
    expect(burnSteps({ ...sample, trainingDays: 0 })).toMatchObject({ trainingKcal: 0, burnKcal: 2123 });
    expect(burnSteps({ ...sample, trainingDays: 3, sessionMinutes: 0 })).toMatchObject({ trainingKcal: 0, burnKcal: 2123 });
    // A very active day lifts the base: 1769 × 1.6 = 2830.4.
    expect(burnSteps({ ...sample, dayActivity: "very_active", trainingDays: 0 }).burnKcal).toBe(2830);
    // The day's step reads the ROUNDED resting burn, so the line the screen
    // prints (1769 × 1.2 = 2123) is the one the number came from.
    expect(burnSteps(sample).dayKcal).toBe(Math.round(1769 * 1.2));
  });

  it("the worked example: calories, macros, change, finish date, and the working behind them", () => {
    const plan = computePlan(sample);
    expect(plan).toEqual({
      restingBurnKcal: 1769,
      dailyBurnKcal: 2255,
      targetKcal: 1705,
      dailyChangeKcal: -550,
      proteinG: 164,
      carbsG: 156,
      fatG: 47,
      plannedTargetKg: 75,
      daysToTarget: 98,
      finishDate: "2026-12-15",
      flags: [],
      workings: {
        resting: { formula: "male", weightKg: 82, heightCm: 175, age: 30, constant: 5, kcal: 1769 },
        day: { activity: "sitting", factor: 1.2, kcal: 2123 },
        training: { kcalPerKgHour: 5, weightKg: 82, trainingDays: 3, sessionMinutes: 45, kcal: 132 },
        change: { pace: "steady", kgPerWeek: 0.5, kcalPerKg: 7700, kcal: -550 },
        beforeFloorKcal: 1705,
        floorKcal: 1200,
        protein: { gPerKg: 2, weightKg: 82, referenceBmi: null, wantedG: 164, buildMuscle: false },
        fatShare: 0.25,
        carbsFloorG: 50,
        finish: { kgToMove: 7, kcalPerKg: 7700 },
      },
    });
  });

  it("counts protein on the weight, never on more than the weight at BMI 30 for the height (Kd, 2026-09-11)", () => {
    // At 175 cm, BMI 30 is 30 × 1.75² = 91.875 → 91.88 kg.
    expect(proteinWeight(70, 165)).toEqual({ kg: 70, referenceBmi: null });
    expect(proteinWeight(91.88, 175)).toEqual({ kg: 91.88, referenceBmi: null }); // on the line: the body itself
    expect(proteinWeight(91.89, 175)).toEqual({ kg: 91.88, referenceBmi: 30 });
    expect(proteinWeight(120, 175)).toEqual({ kg: 91.88, referenceBmi: 30 });
    expect(proteinWeight(100, 160)).toEqual({ kg: 76.8, referenceBmi: 30 });

    // The heavy man Kd was shown: 240 g a day counted whole, 184 g now. His burn
    // is still his whole body's; only protein is counted differently.
    const heavy = computePlan({ ...sample, age: 35, weightKg: 120, targetWeightKg: 90 });
    expect(heavy).toMatchObject({ restingBurnKcal: 2124, dailyBurnKcal: 2742, targetKcal: 2192, proteinG: 184, carbsG: 227, fatG: 61 });
    expect(heavy.workings.protein).toEqual({ gPerKg: 2, weightKg: 91.88, referenceBmi: 30, wantedG: 184, buildMuscle: false });
    expect(heavy.workings.resting.weightKg).toBe(120);
    expect(heavy.workings.training.weightKg).toBe(120);
    // Every goal counts the same weight: 1.6 × 91.88 and 2.2 × 91.88.
    expect(computePlan({ ...sample, age: 35, weightKg: 120, goal: "maintain", targetWeightKg: null, pace: null }).proteinG).toBe(147);
    expect(computePlan({ ...sample, age: 35, weightKg: 120, goal: "gain", targetWeightKg: 125 }).proteinG).toBe(202);
    // A body under the line is counted as it is: the golden woman keeps her 140 g.
    const golden = computePlan({ ...sample, gender: "female", heightCm: 165, weightKg: 70, targetWeightKg: 65 });
    expect(golden.workings.protein).toEqual({ gPerKg: 2, weightKg: 70, referenceBmi: null, wantedG: 140, buildMuscle: false });
  });

  it("sets protein in grams per kilo, never as a share of the calories (Kd, 2026-09-11)", () => {
    // On a cut the grams stay while the calories fall, so their share rises:
    // the golden woman's 140 g are 44 % of her 1,267 kcal, past the 35 % top of
    // the IOM's whole-diet range, and that is the plan working, not a fault.
    const golden = computePlan({ ...sample, gender: "female", heightCm: 165, weightKg: 70, targetWeightKg: 65 });
    expect(golden.targetKcal).toBe(1267);
    expect(golden.proteinG).toBe(140);
    expect((golden.proteinG * 4) / golden.targetKcal).toBeGreaterThan(0.35);
  });

  it("the working names the women's formula only for a female answer", () => {
    expect(computePlan({ ...sample, gender: "female" }).workings.resting).toMatchObject({
      formula: "female",
      constant: -161,
      kcal: Math.round(1768.75 - 166),
    });
    for (const gender of ["male", "other", "prefer_not_to_say"] as const) {
      expect(computePlan({ ...sample, gender }).workings.resting, gender).toMatchObject({ formula: "male", constant: 5, kcal: 1769 });
    }
  });

  it("a plan that holds the weight has no change and no finish in its working", () => {
    const held = [
      computePlan({ ...sample, goal: "maintain", targetWeightKg: null, pace: null }),
      computePlan({ ...sample, age: 17 }), // no cut under 18
      computePlan({ ...sample, targetWeightKg: 90 }), // a "lose" target above the weight
    ];
    for (const plan of held) {
      expect(plan.workings.change).toBeNull();
      expect(plan.workings.finish).toBeNull();
      expect(plan.workings.beforeFloorKcal).toBe(plan.dailyBurnKcal);
      expect(plan.targetKcal).toBe(plan.dailyBurnKcal);
    }
  });

  it("the working shows the cut the pace asked for, and the floor that stopped it", () => {
    // female 25 · 155 cm · 50 kg · sitting · no training: burn 1420 (the floor test below).
    const plan = computePlan({ ...sample, gender: "female", age: 25, heightCm: 155, weightKg: 50, targetWeightKg: 45, trainingDays: 0, pace: "brisk" });
    expect(plan.workings.change).toEqual({ pace: "brisk", kgPerWeek: 0.75, kcalPerKg: 7700, kcal: -825 });
    expect(plan.workings.beforeFloorKcal).toBe(1420 - 825);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.workings.finish).toEqual({ kgToMove: 5, kcalPerKg: 7700 });
  });

  it("protein that gave way to the carbohydrate floor keeps the grams the table asked for beside it", () => {
    // 200 cm: BMI 30 is 120 kg, so protein asks 2 × 120 = 240 g of a 1,322 kcal day.
    const plan = computePlan({ ...sample, gender: "female", age: 120, heightCm: 200, weightKg: 130, targetWeightKg: 120, trainingDays: 0, pace: "brisk" });
    expect(plan.workings.protein).toEqual({ gPerKg: 2, weightKg: 120, referenceBmi: 30, wantedG: 240, buildMuscle: false });
    expect(plan.proteinG).toBe(198);
  });

  it("the contract refuses a protein line that counts a heavier body whole, or names a reference it did not use", () => {
    const heavy = computePlan({ ...sample, age: 35, weightKg: 120, targetWeightKg: 90 });
    expect(planNumbersSchema.safeParse(heavy).success).toBe(true);
    const p = heavy.workings.protein;
    for (const protein of [
      { ...p, weightKg: 120, referenceBmi: null, wantedG: 240 }, // the whole body, multiplied out
      { ...p, referenceBmi: null }, // the BMI-30 weight, unnamed
      { ...p, referenceBmi: 25 }, // a reference the rule does not use
    ]) {
      expect(planNumbersSchema.safeParse({ ...heavy, workings: { ...heavy.workings, protein } }).success, JSON.stringify(protein)).toBe(false);
    }
    // And a body under the line may not claim the cap.
    const light = computePlan(sample);
    const named = { ...light.workings.protein, referenceBmi: 30 };
    expect(planNumbersSchema.safeParse({ ...light, workings: { ...light.workings, protein: named } }).success).toBe(false);
  });

  it("the contract refuses a working that does not add up or multiply out, whichever line breaks", () => {
    const plan = computePlan(sample);
    expect(planNumbersSchema.safeParse(plan).success).toBe(true);
    const w = plan.workings;
    const change = w.change;
    if (change === null) throw new Error("the sample is a cut, so its working has a change");
    const broken = [
      // Each multiplication the screen prints, broken with its kcal left alone:
      // "1,769 × 1.3 = 2,123 kcal" would be false on screen.
      { ...w, day: { ...w.day, factor: 1.3 } },
      { ...w, resting: { ...w.resting, age: 40 } },
      { ...w, training: { ...w.training, sessionMinutes: 60 } },
      { ...w, change: { ...change, kgPerWeek: 0.75 } },
      { ...w, protein: { ...w.protein, gPerKg: 2.5 } },
      // Build muscle claimed on a figure under its own.
      { ...w, protein: { ...w.protein, buildMuscle: true } },
      // Each sum.
      { ...w, day: { ...w.day, kcal: w.day.kcal + 1 } },
      { ...w, training: { ...w.training, kcal: w.training.kcal - 1 } },
      { ...w, resting: { ...w.resting, kcal: w.resting.kcal + 1 } },
      { ...w, change: null },
      { ...w, beforeFloorKcal: w.beforeFloorKcal + 1 },
      { ...w, protein: { ...w.protein, wantedG: plan.proteinG - 1 } },
      { ...w, fatShare: 0.3 },
      { ...w, finish: null },
      { ...w, finish: { kgToMove: 8, kcalPerKg: 7700 } },
      // Each figure printed on two lines, changed on one line only, with every
      // product and sum still holding.
      { ...w, training: { ...w.training, weightKg: 82.3 } }, // still 132 kcal
      { ...w, protein: { ...w.protein, weightKg: 82.2 } }, // still 164 g
      { ...w, resting: { ...w.resting, formula: "female" } }, // with the men's +5
      { ...w, change: { ...change, pace: "brisk" } }, // with steady's 0.5 kg a week
      { ...w, finish: { kgToMove: 6.95, kcalPerKg: 7700 } }, // still 98 days, but 82 − 75 is 7
      { ...w, finish: { kgToMove: 7, kcalPerKg: 7650 } }, // still 98 days, but the pace line says 7,700
    ];
    for (const workings of broken) {
      expect(planNumbersSchema.safeParse({ ...plan, workings }).success, JSON.stringify(workings)).toBe(false);
    }
  });

  it("the contract refuses a figure that reads one way on one line of the panel and another way on the next", () => {
    // Held: "Keeps your weight at …" is the resting line's weight.
    const held = computePlan({ ...sample, goal: "maintain", targetWeightKg: null, pace: null });
    // Floored: "Calories never go below …" is the floor "To eat" names.
    const floored = computePlan({ ...sample, gender: "female", age: 25, heightCm: 155, weightKg: 50, targetWeightKg: 45, trainingDays: 0, pace: "brisk" });
    // Under the healthy weight and dated: the flag's weight is the one "Reach …" names.
    const below = computePlan({ ...sample, gender: "female", age: 20, heightCm: 155, weightKg: 44.6, targetWeightKg: 40 });
    for (const plan of [held, floored, below]) expect(planNumbersSchema.safeParse(plan).success).toBe(true);
    expect(held.daysToTarget).toBeNull();
    expect(floored.flags.map((f) => f.code)).toContain("calorie_floor_applied");
    expect(below.flags.map((f) => f.code)).toContain("target_below_healthy_weight");
    expect(below.daysToTarget).not.toBeNull();
    const broken = [
      { ...held, plannedTargetKg: 80 },
      { ...floored, flags: floored.flags.map((f) => (f.code === "calorie_floor_applied" ? { ...f, floorKcal: 1300 } : f)) },
      { ...below, flags: below.flags.map((f) => (f.code === "target_below_healthy_weight" ? { ...f, floorKg: 44.3 } : f)) },
    ];
    for (const plan of broken) {
      expect(planNumbersSchema.safeParse(plan).success, JSON.stringify(plan.flags)).toBe(false);
    }
  });

  describe("reads no clock", () => {
    afterEach(() => vi.useRealTimers());
    it("every number follows the 'today' passed in, whatever the machine's clock says", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2031-06-01T12:00:00Z"));
      const first = computePlan(sample);
      expect(first.finishDate).toBe("2026-12-15");
      expect(computePlan({ ...sample, today: "2027-01-01" }).finishDate).toBe("2027-04-09");
      // Same answers under a different clock: every field identical, so no field
      // reads the clock (or anything else that varies between calls).
      vi.setSystemTime(new Date("1999-02-03T04:05:06Z"));
      expect(computePlan(sample)).toEqual(first);
      expect(computePlan(sample)).toEqual(first);
    });
  });

  it("the screen's numbers subtract and add up: change = eat − burn, and the grams make the calories", () => {
    // Bodies far from and hard against the floor, every goal, the two the review used.
    const bodies: PlanInputs[] = [
      sample,
      { ...sample, goal: "gain", weightKg: 70, targetWeightKg: 75 },
      { ...sample, goal: "maintain", targetWeightKg: null, pace: null },
      { ...sample, age: 17 },
      { ...sample, gender: "female", age: 20, heightCm: 155, weightKg: 44.6, targetWeightKg: 40 },
      { ...sample, gender: "female", age: 60, heightCm: 150, weightKg: 45, targetWeightKg: 42, pace: "gentle", trainingDays: 0 },
      { ...sample, gender: "female", age: 60, heightCm: 140, weightKg: 58.61, targetWeightKg: 45, pace: "gentle", trainingDays: 0 },
      { ...sample, gender: "female", age: 25, heightCm: 155, weightKg: 50, targetWeightKg: 45, trainingDays: 0, pace: "brisk" },
      { ...sample, weightKg: 150, targetWeightKg: 140, trainingDays: 0, pace: "brisk" },
      { ...sample, gender: "female", age: 80, heightCm: 140, weightKg: 150, targetWeightKg: 140, trainingDays: 0, pace: "brisk" },
    ];
    for (const body of bodies) expectSanePlan(body);
  });

  it("every corner of the schema yields a plan the contract accepts and the screen can add up", () => {
    // Not hand-picked: a grid over the rails and the values that flip a rule
    // (16/17/18 for the age rule, the 50 cm and 300 cm heights, the lightest and
    // heaviest bodies, targets on both sides and far past the horizon, every
    // pace, the extremes of the day and the week, an all-yes health screen).
    const goals = ["lose", "gain", "maintain"] as const;
    const genders = ["female", "male"] as const;
    const ages = [16, 18, 120];
    const heights = [50, 170, 300];
    const weights = [0.01, 45, 150, 999.99];
    const targetOf = (w: number) =>
      [0.01, w * 0.5, w - 0.01, w, w + 0.01, w * 1.5, 999.99]
        .map((t) => Math.min(999.99, Math.max(0.01, Math.round(t * 100) / 100)));
    const paces = ["gentle", "brisk"] as const;
    const days = ["sitting", "very_active"] as const;
    const weeks = [{ trainingDays: 0, sessionMinutes: 0 }, { trainingDays: 7, sessionMinutes: 240 }];
    const healths = [null, { hasCondition: true, safeMode: false }, { hasCondition: true, safeMode: true }];
    let bodies = 0;
    const unaccepted: PlanInputs[] = [];
    const failures: { body: PlanInputs; broken: string[] }[] = [];
    for (const goal of goals) for (const gender of genders) for (const age of ages) for (const heightCm of heights)
      for (const weightKg of weights) for (const dayActivity of days) for (const week of weeks) for (const health of healths)
      for (const buildMuscle of [false, true]) {
        const base = { goal, gender, age, heightCm, weightKg, dayActivity, ...week, health, buildMuscle, today: "2026-09-08" };
        const variants: PlanInputs[] = goal === "maintain"
          ? [{ ...base, targetWeightKg: null, pace: null }]
          : targetOf(weightKg).flatMap((targetWeightKg) => paces.map((pace) => ({ ...base, targetWeightKg, pace })));
        for (const body of variants) {
          if (!planInputsSchema.safeParse(body).success) unaccepted.push(body);
          const broken = brokenFacts(body);
          if (broken.length > 0) failures.push({ body, broken });
          bodies += 1;
        }
      }
    expect(unaccepted).toEqual([]);
    expect(failures.slice(0, 5)).toEqual([]);
    expect(bodies).toBeGreaterThan(5_000);
  });

  it("dailyChangeKcal is the difference of the two rounded numbers, not a rounded raw difference", () => {
    // female 20 · 155 cm · 44.6 kg · no training: resting 1153.75 → 1154, burn 1154 · 1.2 = 1384.8 → 1385; eat 1200.
    // The raw difference −184.5 rounds to −184 (the review's finding); the screen subtracts −185.
    const plan = computePlan({ ...sample, gender: "female", age: 20, heightCm: 155, weightKg: 44.6, targetWeightKg: 40, trainingDays: 0 });
    expect(plan.dailyBurnKcal).toBe(1385);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(-185);
  });

  it("maintain: eat what you burn, no finish date, 1.6 g protein per kilo", () => {
    const plan = computePlan({ ...sample, goal: "maintain", targetWeightKg: null, pace: null });
    expect(plan.targetKcal).toBe(2255);
    expect(plan.dailyChangeKcal).toBe(0);
    expect(plan.daysToTarget).toBeNull();
    expect(plan.finishDate).toBeNull();
    expect(plan.plannedTargetKg).toBe(82);
    expect(plan.proteinG).toBe(Math.round(82 * 1.6));
    expect(plan.flags).toEqual([]);
  });

  it("gain: a surplus, 2.2 g protein per kilo, the finish date from the same pace table", () => {
    const plan = computePlan({ ...sample, goal: "gain", weightKg: 70, targetWeightKg: 75 });
    expect(plan.dailyChangeKcal).toBe(550);
    expect(plan.targetKcal).toBe(plan.dailyBurnKcal + 550);
    expect(plan.proteinG).toBe(Math.round(70 * 2.2));
    expect(plan.daysToTarget).toBe(Math.ceil((5 * 7700) / 550)); // 70
    expect(plan.finishDate).toBe(addDays("2026-09-08", 70));
    expect(plan.flags).toEqual([]);
  });

  it("Build muscle ticked sets protein to 2.2 g per kilo whatever the weight choice, and moves no calorie (RULINGS 2026-09-11)", () => {
    const bodies: PlanInputs[] = [
      sample, // lose
      { ...sample, goal: "maintain", targetWeightKg: null, pace: null },
      { ...sample, goal: "gain", weightKg: 70, targetWeightKg: 75 },
    ];
    for (const body of bodies) {
      const plain = computePlan(body);
      const muscle = computePlan({ ...body, buildMuscle: true });
      expect(muscle.workings.protein, body.goal).toMatchObject({ gPerKg: 2.2, buildMuscle: true });
      // Every number but protein and carbohydrates is the same plan's.
      const same = ["restingBurnKcal", "dailyBurnKcal", "targetKcal", "dailyChangeKcal", "fatG", "plannedTargetKg", "daysToTarget", "finishDate"] as const;
      for (const key of same) expect(muscle[key], `${body.goal} ${key}`).toEqual(plain[key]);
      // The flags too, but for the one line Build muscle adds to a cut over the
      // limit: the sample's steady cut of 550 (RULINGS 2026-09-13).
      expect(muscle.flags.filter((f) => f.code !== "cut_limits_muscle_gain"), body.goal).toEqual(plain.flags);
      expectSanePlan({ ...body, buildMuscle: true });
    }
    expect(computePlan({ ...sample, buildMuscle: true }).flags).toEqual([
      { code: "cut_limits_muscle_gain", limitKcal: 500, suggestedPace: "gentle" },
    ]);
    // The sample man losing weight: 2.2 × 82 = 180 g, not the loss figure's
    // 164, and the carbohydrates give way to it: (1705 − 721.6 − 426.25) ÷ 4.
    expect(computePlan({ ...sample, buildMuscle: true })).toMatchObject({ targetKcal: 1705, proteinG: 180, carbsG: 139, fatG: 47 });
  });

  it("carbohydrates never drop below 50 g: protein gives way so the grams still make the calories", () => {
    // female 120 · 200 cm · 130 kg · sitting · no training: resting 1789, burn 2146.8 → 2147;
    // brisk −825 = 1322. Counted on 120 kg (BMI 30 at 200 cm), 2 g/kg would be 240 g protein
    // (960 kcal) + 36.7 g fat (330.5) — more than the day holds. Fat keeps its share, carbs
    // take the floor, protein takes the rest.
    const plan = computePlan({ ...sample, gender: "female", age: 120, heightCm: 200, weightKg: 130, targetWeightKg: 120, trainingDays: 0, pace: "brisk" });
    expect(plan.targetKcal).toBe(1322);
    expect(plan.fatG).toBe(Math.round((1322 * 0.25) / 9)); // 37
    expect(plan.carbsG).toBe(50);
    expect(plan.proteinG).toBe(Math.round((1322 - 200 - 1322 * 0.25) / 4)); // 198, not 240
    // Three roundings can drift the sum by at most 2 + 2 + 4.5 kcal.
    expect(Math.abs(plan.proteinG * 4 + plan.carbsG * 4 + plan.fatG * 9 - 1322)).toBeLessThanOrEqual(9);
    // A body the table fits keeps its full protein and carbs above the floor.
    expect(macrosFor(1704, 82, 2)).toEqual({ proteinG: 164, carbsG: 156, fatG: 47 });
  });

  it("counts the days in whole hundredths of a kilo, so a floating-point crumb never adds a day", () => {
    // 64.01 → 63.01 is exactly 1 kg, and 1 × 7700 ÷ 275 is exactly 28 days. In
    // floating point 64.01 − 63.01 is 1.0000000000000142, which rounded UP to
    // 29 — a date one day later than the sum the plan screen prints.
    const plan = computePlan({ ...sample, weightKg: 64.01, targetWeightKg: 63.01, pace: "gentle" });
    expect(plan.daysToTarget).toBe(28);
    expect(plan.finishDate).toBe(addDays(sample.today, 28));
  });

  it("addDays walks the calendar, month ends and leap days included", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-09-08", 98)).toBe("2026-12-15");
    expect(addDays("2026-09-08", 0)).toBe("2026-09-08");
  });
});

describe("plan maths — the sanity rules", () => {
  it("target direction: a 'lose' target at or above the current weight moves nothing", () => {
    for (const target of [82, 85]) {
      const plan = computePlan({ ...sample, targetWeightKg: target });
      expect(plan.flags).toEqual([{ code: "target_wrong_direction" }]);
      expect(plan.dailyChangeKcal).toBe(0);
      expect(plan.targetKcal).toBe(plan.dailyBurnKcal);
      expect(plan.daysToTarget).toBeNull();
      expect(plan.finishDate).toBeNull();
      expect(plan.plannedTargetKg).toBe(82);
    }
  });

  it("target direction: a 'gain' target at or below the current weight moves nothing", () => {
    for (const target of [82, 70]) {
      const plan = computePlan({ ...sample, goal: "gain", targetWeightKg: target });
      expect(plan.flags).toEqual([{ code: "target_wrong_direction" }]);
      expect(plan.dailyChangeKcal).toBe(0);
      expect(plan.daysToTarget).toBeNull();
    }
  });

  it("healthy-weight floor: BMI 18.5 for the height", () => {
    expect(healthyWeightFloorKg(175)).toBeCloseTo(56.65625, 6);
    expect(healthyWeightFloorKg(160)).toBeCloseTo(47.36, 6);
  });

  it("a target below the healthy floor is named and the plan runs to the floor instead — the same rounded floor in both", () => {
    const plan = computePlan({ ...sample, targetWeightKg: 50 });
    expect(plan.flags).toEqual([{ code: "target_below_healthy_weight", floorKg: 56.7 }]);
    expect(plan.plannedTargetKg).toBe(56.7);
    // 25.3 kg at 550 a day.
    expect(plan.daysToTarget).toBe(Math.ceil((25.3 * 7700) / 550)); // 355
    expect(plan.dailyChangeKcal).toBe(-550);
  });

  it("someone already under the healthy floor who wants to lose gets no cut", () => {
    const plan = computePlan({ ...sample, weightKg: 55, targetWeightKg: 50 });
    expect(plan.flags).toEqual([{ code: "target_below_healthy_weight", floorKg: 56.7 }]);
    expect(plan.dailyChangeKcal).toBe(0);
    expect(plan.daysToTarget).toBeNull();
    expect(plan.plannedTargetKg).toBe(55);
  });

  it("over a year: flagged, with the gentlest pace that finishes within a year", () => {
    // 22 kg at gentle (275 a day) = 616 days; steady (550) = 308 days.
    const plan = computePlan({ ...sample, targetWeightKg: 60, pace: "gentle" });
    expect(plan.daysToTarget).toBe(616);
    expect(plan.flags).toEqual([{ code: "pace_over_a_year", suggestedPace: "steady" }]);
    // The plan still runs at the pace chosen.
    expect(plan.dailyChangeKcal).toBe(-275);
    expect(plan.finishDate).toBe(addDays("2026-09-08", 616));
  });

  it("over a year at every pace: the suggestion is null", () => {
    // 40 kg gain: brisk (825 a day) = 374 days.
    const plan = computePlan({ ...sample, goal: "gain", weightKg: 60, targetWeightKg: 100, pace: "gentle" });
    expect(plan.flags).toEqual([{ code: "pace_over_a_year", suggestedPace: null }]);
    expect(computePlan({ ...sample, goal: "gain", weightKg: 60, targetWeightKg: 100, pace: "brisk" }).daysToTarget).toBe(374);
  });

  it("a plan that finishes on day 365 exactly is not flagged", () => {
    // 550 a day for 365 days moves 26.07 kg; ask for a hair less.
    const kg = (365 * 550) / 7700 - 0.01;
    const plan = computePlan({ ...sample, weightKg: 100, targetWeightKg: 100 - kg });
    expect(plan.daysToTarget).toBe(365);
    expect(plan.flags).toEqual([]);
  });

  it("the suggested pace respects the calorie floor: a pace the floor blocks is never suggested", () => {
    // female 25 · 150 cm · 60 kg · sitting · no training: resting 1251.5 → 1252, burn
    // 1252 · 1.2 = 1502.4 → 1502, so only 302 a day sits above the floor. 15 kg at gentle
    // (275) = 420 days; steady and brisk are both cut to 302 a day = 383 days — over a year at
    // EVERY pace, so no pace can be suggested.
    const person = { ...sample, gender: "female" as const, age: 25, heightCm: 150, weightKg: 60, targetWeightKg: 45, trainingDays: 0 };
    const gentle = computePlan({ ...person, pace: "gentle" });
    expect(gentle.daysToTarget).toBe(420);
    expect(gentle.flags).toEqual([{ code: "pace_over_a_year", suggestedPace: null }]);
    const steady = computePlan({ ...person, pace: "steady" });
    expect(steady.daysToTarget).toBe(383);
    expect(steady.flags).toEqual([
      { code: "calorie_floor_applied", floorKcal: 1200 },
      { code: "pace_over_a_year", suggestedPace: null },
    ]);
  });

  it("calorie floor: the cut stops at 1200 and the finish date moves out", () => {
    // female 25 · 155 cm · 50 kg · sitting · no training: resting 1182.75 → 1183, burn
    // 1183 · 1.2 = 1419.6 → 1420. brisk asks 825 a day; only 220 is above the floor.
    const plan = computePlan({
      ...sample,
      gender: "female",
      age: 25,
      heightCm: 155,
      weightKg: 50,
      targetWeightKg: 45,
      trainingDays: 0,
      pace: "brisk",
    });
    expect(plan.dailyBurnKcal).toBe(1420);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(1200 - 1420);
    expect(plan.flags).toContainEqual({ code: "calorie_floor_applied", floorKcal: 1200 });
    // 5 kg at 220 a day = exactly 175 days, not the 47 brisk would have promised.
    expect(plan.daysToTarget).toBe(175);
    expect(plan.finishDate).toBe(addDays("2026-09-08", 175));
  });

  it("calorie floor: a burn already under 1200 eats 1200, and a cut is impossible", () => {
    // female 60 · 130 cm · 35 kg · sitting · no training: resting 701.5 → 702, burn 702 · 1.2 = 842.4 → 842.
    // The healthy floor for 130 cm is 31.27 kg, so 30 clamps to it — still under 35.
    const plan = computePlan({
      ...sample,
      gender: "female",
      age: 60,
      heightCm: 130,
      weightKg: 35,
      targetWeightKg: 30,
      trainingDays: 0,
      pace: "gentle",
    });
    expect(plan.dailyBurnKcal).toBe(842);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(1200 - 842);
    expect(plan.daysToTarget).toBeNull();
    expect(plan.finishDate).toBeNull();
    expect(plan.plannedTargetKg).toBe(35);
    expect(plan.flags).toEqual([
      { code: "target_below_healthy_weight", floorKg: 31.3 },
      { code: "calorie_floor_applied", floorKcal: 1200 },
      { code: "target_out_of_reach" },
    ]);
  });

  it("the floor leaves a cut of exactly nothing: no date in the year 4417, the target is out of reach", () => {
    // female 60 · 140 cm · 58.61 kg · sitting · no training: resting 1000.1 → 1000, burn 1000 · 1.2 = 1200.
    // gentle asks 275; the floor gives back 1200; the change is 0 and nothing moves.
    const plan = computePlan({ ...sample, gender: "female", age: 60, heightCm: 140, weightKg: 58.61, targetWeightKg: 45, pace: "gentle", trainingDays: 0 });
    expect(plan.dailyBurnKcal).toBe(1200);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(0);
    expect(plan.daysToTarget).toBeNull();
    expect(plan.finishDate).toBeNull();
    expect(plan.plannedTargetKg).toBe(58.61);
    expect(plan.flags).toEqual([{ code: "target_out_of_reach" }]);
  });

  it("a 'lose' plan the floor turns into a surplus says so, instead of a cut flag beside a plus number", () => {
    // female 60 · 150 cm · 45 kg → 42 (above the 41.6 floor) · sitting · no training: resting 926.5
    // → 927, burn 927 · 1.2 = 1112.4 → 1112; 1200 is 88 above it. The plan holds the weight and says why.
    const plan = computePlan({ ...sample, gender: "female", age: 60, heightCm: 150, weightKg: 45, targetWeightKg: 42, pace: "gentle", trainingDays: 0 });
    expect(plan.dailyBurnKcal).toBe(1112);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(88);
    expect(plan.daysToTarget).toBeNull();
    expect(plan.plannedTargetKg).toBe(45);
    expect(plan.flags).toEqual([
      { code: "calorie_floor_applied", floorKcal: 1200 },
      { code: "target_out_of_reach" },
    ]);
  });

  it("a target more than ten years away is out of reach, and the calories then hold the weight", () => {
    // male 30 · 175 cm · 60 kg gaining at brisk (825 a day): resting 1548.75 → 1549, day 1859, training 96: burn 1955.
    const kgOnTheHorizon = (MAX_PLAN_DAYS * 825) / KCAL_PER_KG - 0.01;
    const just = computePlan({ ...sample, goal: "gain", weightKg: 60, targetWeightKg: 60 + kgOnTheHorizon, pace: "brisk" });
    expect(just.daysToTarget).toBe(MAX_PLAN_DAYS);
    expect(just.dailyChangeKcal).toBe(825);
    expect(just.flags).toEqual([{ code: "pace_over_a_year", suggestedPace: null }]);
    expect(just.finishDate).toBe(addDays("2026-09-08", MAX_PLAN_DAYS));

    const beyond = computePlan({ ...sample, goal: "gain", weightKg: 60, targetWeightKg: 60 + kgOnTheHorizon + 0.02, pace: "brisk" });
    expect(beyond.daysToTarget).toBeNull();
    expect(beyond.finishDate).toBeNull();
    expect(beyond.dailyChangeKcal).toBe(0);
    expect(beyond.targetKcal).toBe(1955);
    expect(beyond.plannedTargetKg).toBe(60);
    expect(beyond.flags).toEqual([{ code: "target_out_of_reach" }]);
  });

  it("resolvePlan answers every body its schema accepts (the review's crash: a fraction of a kcal a day)", () => {
    const answers = planAnswersSchema.parse({
      goal: "lose", age: 60, gender: "female", heightCm: 140, weightKg: 58.61, targetWeightKg: 45,
      pace: "gentle", dayActivity: "sitting", trainingDays: 0, sessionMinutes: 45, today: "2026-09-08",
    });
    const r = resolvePlan(answers);
    expect(r.missing).toEqual([]);
    expect(r.plan?.finishDate).toBeNull();
    expect(r.plan?.flags).toEqual([{ code: "target_out_of_reach" }]);
    // The latest day the contract accepts still yields a date the contract accepts.
    const lateDay = "9989-12-31";
    expect(resolvePlan({ ...sample, today: lateDay }).plan?.finishDate).toBe("9990-04-08");
    const farthest = { ...sample, goal: "gain" as const, weightKg: 60, targetWeightKg: 60 + (MAX_PLAN_DAYS * 825) / KCAL_PER_KG - 0.01, pace: "brisk" as const, today: lateDay };
    expect(resolvePlan(farthest).plan?.daysToTarget).toBe(MAX_PLAN_DAYS);
    expect(resolvePlan(farthest).plan?.finishDate).toBe(addDays(lateDay, MAX_PLAN_DAYS));
  });

  it("calorie floor holds for maintain and gain too", () => {
    const small = { ...sample, gender: "female" as const, age: 60, heightCm: 130, weightKg: 35, trainingDays: 0 };
    const keep = computePlan({ ...small, goal: "maintain", targetWeightKg: null, pace: null });
    expect(keep.targetKcal).toBe(1200);
    expect(keep.flags).toEqual([{ code: "calorie_floor_applied", floorKcal: 1200 }]);
    // Burn 842 + a gentle surplus 275 = 1117, under the floor: the gain plan
    // sits on 1200 and says so, and still moves the weight (faster than asked).
    const gain = computePlan({ ...small, goal: "gain", targetWeightKg: 40, pace: "gentle" });
    expect(gain.dailyBurnKcal).toBe(842);
    expect(gain.targetKcal).toBe(1200);
    expect(gain.dailyChangeKcal).toBe(358);
    expect(gain.flags).toEqual([{ code: "calorie_floor_applied", floorKcal: 1200 }]);
    expect(gain.daysToTarget).toBe(Math.ceil((5 * KCAL_PER_KG) / 358));
  });

  it("no calorie deficit under 18: calories stay at daily burn, the flag says why", () => {
    const plan = computePlan({ ...sample, age: 17 });
    expect(plan.flags).toEqual([{ code: "no_deficit", reasons: ["under_18"] }]);
    expect(plan.dailyChangeKcal).toBe(0);
    expect(plan.targetKcal).toBe(plan.dailyBurnKcal);
    expect(plan.daysToTarget).toBeNull();
    expect(plan.finishDate).toBeNull();
    expect(plan.plannedTargetKg).toBe(82);
    // 18 is an adult for this rule; 16 and 17 are not.
    expect(computePlan({ ...sample, age: 18 }).flags).toEqual([]);
    expect(computePlan({ ...sample, age: 16 }).flags).toEqual([{ code: "no_deficit", reasons: ["under_18"] }]);
  });

  it("no calorie deficit for a yes on the health question, cleared or not (one question, Kd 2026-09-09)", () => {
    for (const health of [{ hasCondition: true, safeMode: false }, { hasCondition: true, safeMode: true }]) {
      const plan = computePlan({ ...sample, health });
      expect(plan.flags[0]).toEqual({ code: "no_deficit", reasons: health.safeMode ? ["health_answer", "safe_mode"] : ["health_answer"] });
      expect(plan.flags).toHaveLength(1);
      expect(plan.dailyChangeKcal).toBe(0);
      expect(plan.targetKcal).toBe(plan.dailyBurnKcal);
      expect(plan.daysToTarget).toBeNull();
      expect(plan.plannedTargetKg).toBe(82);
    }
    // A "no" is not a rule: the cut runs.
    expect(computePlan({ ...sample, health: { hasCondition: false, safeMode: false } }).flags).toEqual([]);
  });

  it("every reason is listed, in one fixed order", () => {
    expect(noDeficitReasons({ age: 17, health: { hasCondition: true, safeMode: true } })).toEqual(["under_18", "health_answer", "safe_mode"]);
    expect(noDeficitReasons({ age: 17, health: { hasCondition: true, safeMode: false } })).toEqual(["under_18", "health_answer"]);
    expect(noDeficitReasons({ age: 40, health: { hasCondition: false, safeMode: false } })).toEqual([]);
    expect(noDeficitReasons({ age: 40, health: null })).toEqual([]);
  });

  it("the contract refuses Safe mode without a yes — the two facts cannot contradict", () => {
    expect(planHealthSchema.safeParse({ hasCondition: false, safeMode: true }).success).toBe(false);
    expect(planHealthSchema.safeParse({ hasCondition: true, safeMode: true }).success).toBe(true);
    expect(planHealthSchema.safeParse({ hasCondition: false, safeMode: false }).success).toBe(true);
    expect(planHealthSchema.safeParse({ pregnant: true }).success).toBe(false); // the old shape is gone
  });

  it("an unanswered health screen applies no condition rule yet; the age rule needs no answer", () => {
    expect(computePlan({ ...sample, health: null }).flags).toEqual([]);
    expect(computePlan({ ...sample, health: null, age: 17 }).flags).toEqual([{ code: "no_deficit", reasons: ["under_18"] }]);
  });

  it("the rules only refuse a CUT: a gain or a maintain is untouched by them", () => {
    const flagged = { hasCondition: true, safeMode: true };
    const gain = computePlan({ ...sample, age: 17, health: flagged, goal: "gain", weightKg: 60, targetWeightKg: 65 });
    expect(gain.flags).toEqual([]);
    expect(gain.dailyChangeKcal).toBe(550);
    const keep = computePlan({ ...sample, age: 17, health: flagged, goal: "maintain", targetWeightKg: null, pace: null });
    expect(keep.flags).toEqual([]);
  });

  it("a wrong-direction 'lose' target is not also reported as a refused cut", () => {
    const plan = computePlan({ ...sample, age: 17, targetWeightKg: 90 });
    expect(plan.flags).toEqual([{ code: "target_wrong_direction" }]);
  });

  describe("building muscle while losing weight (Kd, 2026-09-13: tell them)", () => {
    const muscleLine = { code: "cut_limits_muscle_gain", limitKcal: 500, suggestedPace: "gentle" };
    const muscle: PlanInputs = { ...sample, buildMuscle: true };

    it("a cut over 500 kcal a day says so and suggests the gentle pace; the calories stay the weight choice's", () => {
      for (const pace of ["steady", "brisk"] as const) {
        const plan = computePlan({ ...muscle, pace });
        expect(plan.flags, pace).toEqual([muscleLine]);
        expect(plan.targetKcal, pace).toBe(computePlan({ ...sample, pace }).targetKcal);
        expect(plan.dailyChangeKcal, pace).toBe(-paceDailyKcal(pace));
      }
      // Gentle cuts 275 a day: room to grow, nothing to say.
      expect(computePlan({ ...muscle, pace: "gentle" }).flags).toEqual([]);
      // The same cut without Build muscle ticked says nothing either.
      expect(computePlan({ ...sample, pace: "brisk" }).flags).toEqual([]);
    });

    it("says nothing where nothing is cut: keeping or gaining weight, under 18, or a yes on the health question", () => {
      const noCut: PlanInputs[] = [
        { ...muscle, goal: "maintain", targetWeightKg: null, pace: null },
        { ...muscle, goal: "gain", weightKg: 70, targetWeightKg: 75, pace: "brisk" },
        { ...muscle, age: 17, pace: "brisk" },
        { ...muscle, pace: "brisk", health: { hasCondition: true, safeMode: false } },
        { ...muscle, pace: "brisk", health: { hasCondition: true, safeMode: true } },
      ];
      for (const body of noCut) {
        const plan = computePlan(body);
        expect(plan.dailyChangeKcal, JSON.stringify(body)).toBeGreaterThanOrEqual(0);
        expect(plan.flags.map((f) => f.code), JSON.stringify(body)).not.toContain("cut_limits_muscle_gain");
      }
    });

    it("counts the cut eaten, after the calorie floor: 500 says nothing, 501 says so", () => {
      // female 30 · 165 cm · 67 kg · sitting · 2 × 20 min: resting 1390, day 1668, training
      // 5 × 67 × 40 min ÷ 60 ÷ 7 = 31.9 → 32, burn 1700. Brisk asks for 875, floored to 1200: a cut of 500.
      const at = computePlan({ ...muscle, gender: "female", heightCm: 165, weightKg: 67, targetWeightKg: 60, pace: "brisk", trainingDays: 2, sessionMinutes: 20 });
      expect([at.dailyBurnKcal, at.targetKcal]).toEqual([1700, 1200]);
      expect(at.flags).toEqual([{ code: "calorie_floor_applied", floorKcal: 1200 }]);
      // female 30 · 165 cm · 61.5 kg · sitting · 3 × 45 min: resting 1335, day 1602, training
      // 5 × 61.5 × 135 min ÷ 60 ÷ 7 = 98.8 → 99, burn 1701. Floored to 1200: a cut of 501.
      const over = computePlan({ ...muscle, gender: "female", heightCm: 165, weightKg: 61.5, targetWeightKg: 55, pace: "brisk" });
      expect([over.dailyBurnKcal, over.targetKcal]).toEqual([1701, 1200]);
      expect(over.flags).toEqual([{ code: "calorie_floor_applied", floorKcal: 1200 }, muscleLine]);
      expectSanePlan({ ...muscle, gender: "female", heightCm: 165, weightKg: 61.5, targetWeightKg: 55, pace: "brisk" });
    });

    it("the contract refuses a muscle line the plan's own numbers do not bear out", () => {
      const flagged = computePlan({ ...muscle, pace: "brisk" });
      expect(planNumbersSchema.safeParse(flagged).success).toBe(true);
      const at500 = computePlan({ ...muscle, gender: "female", heightCm: 165, weightKg: 67, targetWeightKg: 60, pace: "brisk", trainingDays: 2, sessionMinutes: 20 });
      const lies = [
        // Build muscle not ticked.
        { ...flagged, workings: { ...flagged.workings, protein: { ...flagged.workings.protein, buildMuscle: false } } },
        // A limit, or a pace, other than the ones screen 3 and the sentence use.
        { ...flagged, flags: [{ ...muscleLine, limitKcal: 400 }] },
        { ...flagged, flags: [{ ...muscleLine, suggestedPace: "steady" }] },
        { ...flagged, flags: [{ ...muscleLine, suggestedPace: null }] },
        // A cut of exactly the limit.
        { ...at500, flags: [...at500.flags, muscleLine] },
      ];
      for (const plan of lies) expect(planNumbersSchema.safeParse(plan).success, JSON.stringify(plan.flags)).toBe(false);
    });
  });
});

describe("plan maths — missing answers", () => {
  const today = "2026-09-08";

  it("nothing answered: every first-screen answer is missing; target and pace wait for the goal", () => {
    expect(missingPlanInputs({ today })).toEqual([
      "goal",
      "age",
      "gender",
      "heightCm",
      "weightKg",
      "dayActivity",
      "trainingDays",
      "sessionMinutes",
    ]);
  });

  it("a lose or gain goal adds the target and the pace; maintain never asks for them", () => {
    expect(missingPlanInputs({ today, goal: "lose" })).toContain("targetWeightKg");
    expect(missingPlanInputs({ today, goal: "lose" })).toContain("pace");
    expect(missingPlanInputs({ today, goal: "gain" })).toContain("pace");
    expect(missingPlanInputs({ today, goal: "maintain" })).not.toContain("targetWeightKg");
    expect(missingPlanInputs({ today, goal: "maintain" })).not.toContain("pace");
  });

  it("health is never 'missing': the number shows before the health screen is reached", () => {
    const answers: PlanAnswers = { ...sample };
    delete answers.health;
    expect(missingPlanInputs(answers)).toEqual([]);
    expect(resolvePlan(answers).plan).toEqual(computePlan({ ...sample, health: null }));
  });

  it("resolvePlan: the numbers, or the list — never both, never a number from a default", () => {
    const full = resolvePlan(sample);
    expect(full.missing).toEqual([]);
    expect(full.plan).toEqual(computePlan(sample));

    const partial = resolvePlan({ today, goal: "lose", age: 30, gender: "male" });
    expect(partial.plan).toBeNull();
    expect(partial.missing).toEqual(["heightCm", "weightKg", "targetWeightKg", "pace", "dayActivity", "trainingDays", "sessionMinutes"]);
  });

  it("a maintain plan needs no target and computes", () => {
    const r = resolvePlan({ ...sample, goal: "maintain", targetWeightKg: null, pace: null });
    expect(r.missing).toEqual([]);
    expect(r.plan?.dailyChangeKcal).toBe(0);
  });

  it("the 'missing' list can name every calculator input, so a dropped key cannot become a 500", () => {
    expect([...missingPlanInputSchema.options].sort()).toEqual([...CALCULATOR_INPUTS].sort());
    expect(CALCULATOR_INPUTS).not.toContain("today");
    expect(CALCULATOR_INPUTS).not.toContain("health");
    // A goal left unticked is an answer, never a gap in the plan.
    expect(CALCULATOR_INPUTS).not.toContain("buildMuscle");
  });
});

describe("plan contract (@app/shared)", () => {
  it("calendar days must be real, zero-padded days", () => {
    expect(calendarDaySchema.safeParse("2026-09-08").success).toBe(true);
    expect(calendarDaySchema.safeParse("2028-02-29").success).toBe(true);
    expect(calendarDaySchema.safeParse("2026-02-30").success).toBe(false);
    expect(calendarDaySchema.safeParse("2026-9-8").success).toBe(false);
    expect(calendarDaySchema.safeParse("2026-09-08T00:00:00Z").success).toBe(false);
  });

  it("a plan's start day leaves ten years of room inside four-digit years; a finish date is any real day", () => {
    expect(planStartDaySchema.safeParse("1999-12-31").success).toBe(false);
    expect(planStartDaySchema.safeParse("2000-01-01").success).toBe(true);
    expect(planStartDaySchema.safeParse("9989-12-31").success).toBe(true);
    expect(planStartDaySchema.safeParse("9990-01-01").success).toBe(false);
    expect(calendarDaySchema.safeParse("9999-12-29").success).toBe(true);
    expect(planAnswersSchema.safeParse({ today: "9990-01-01" }).success).toBe(false);
  });

  it("the app is for 16 and over; the rails match the profile's, two decimals included", () => {
    expect(planInputsSchema.safeParse({ ...sample, age: 15 }).success).toBe(false);
    expect(planInputsSchema.safeParse({ ...sample, age: 16 }).success).toBe(true);
    expect(planInputsSchema.safeParse({ ...sample, trainingDays: 8 }).success).toBe(false);
    expect(planInputsSchema.safeParse({ ...sample, extra: 1 }).success).toBe(false);
    for (const key of ["heightCm", "weightKg", "targetWeightKg"] as const) {
      expect(planInputsSchema.safeParse({ ...sample, [key]: 58.61 }).success, key).toBe(true);
      expect(planInputsSchema.safeParse({ ...sample, [key]: 58.6001 }).success, key).toBe(false);
    }
  });

  it("answers may be partial but today is required and unknown keys are refused", () => {
    expect(planAnswersSchema.safeParse({ today: "2026-09-08" }).success).toBe(true);
    expect(planAnswersSchema.safeParse({}).success).toBe(false);
    expect(planAnswersSchema.safeParse({ today: "2026-09-08", weight: 80 }).success).toBe(false);
  });

  it("plan is null exactly when missing is non-empty", () => {
    expect(planResponseSchema.safeParse({ plan: null, missing: [] }).success).toBe(false);
    expect(planResponseSchema.safeParse({ plan: computePlan(sample), missing: ["age"] }).success).toBe(false);
    expect(planResponseSchema.safeParse({ plan: null, missing: ["age"] }).success).toBe(true);
    expect(planResponseSchema.safeParse({ plan: computePlan(sample), missing: [] }).success).toBe(true);
  });
});
