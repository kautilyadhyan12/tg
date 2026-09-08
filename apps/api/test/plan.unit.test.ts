import { describe, expect, it } from "vitest";
import { calendarDaySchema, planAnswersSchema, planInputsSchema, planResponseSchema, type PlanAnswers, type PlanInputs } from "@app/shared";
import {
  ADULT_AGE,
  CALORIE_FLOOR_KCAL,
  DAY_FACTOR,
  HEALTHY_BMI_FLOOR,
  KCAL_PER_KG,
  ONE_YEAR_DAYS,
  PACE_KG_PER_WEEK,
  PROTEIN_G_PER_KG,
  TRAINING_MET,
  addDays,
  computePlan,
  dailyBurn,
  healthyWeightFloorKg,
  missingPlanInputs,
  noDeficitReasons,
  resolvePlan,
  restingBurn,
} from "../src/modules/plan/maths.js";

// The worked example every golden below is hand-computed from:
//   resting burn  = 10·82 + 6.25·175 − 5·30 + 5            = 1768.75
//   training      = 5 MET · 82 kg · 0.75 h · 3 days / 7    = 131.7857…
//   daily burn    = 1768.75 · 1.2 + 131.7857               = 2254.2857… → 2254
//   steady cut    = 0.5 kg/wk · 7700 / 7                   = 550 a day
//   eat           = 2254.2857 − 550                        = 1704.2857… → 1704
//   days          = ⌈7 kg · 7700 / 550⌉                    = 98 → 2026-12-15
//   protein 82·2 = 164 · fat 1704.2857·0.25/9 = 47.34 → 47 · carbs (1704.2857 − 656 − 426.07)/4 = 155.55 → 156
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
  health: { pregnant: false, heart: false, bloodPressure: false, diabetes: false },
  today: "2026-09-08",
};

describe("plan maths — the numbers (Stage 1 item 3a)", () => {
  it("pins the tables the numbers come from", () => {
    expect(KCAL_PER_KG).toBe(7700);
    expect(CALORIE_FLOOR_KCAL).toBe(1200); // nutrition/targets.ts:167
    expect(ADULT_AGE).toBe(18);
    expect(HEALTHY_BMI_FLOOR).toBe(18.5);
    expect(ONE_YEAR_DAYS).toBe(365);
    expect(TRAINING_MET).toBe(5);
    expect(PACE_KG_PER_WEEK).toEqual({ gentle: 0.25, steady: 0.5, brisk: 0.75 });
    expect(DAY_FACTOR).toEqual({ sitting: 1.2, on_feet: 1.3, active: 1.45, very_active: 1.6 });
    expect(PROTEIN_G_PER_KG).toEqual({ lose: 2.0, gain: 2.2, maintain: 1.6 }); // targets.ts:174
  });

  it("resting burn is Mifflin-St Jeor; only 'female' takes −161", () => {
    expect(restingBurn(sample)).toBeCloseTo(1768.75, 6);
    expect(restingBurn({ ...sample, gender: "female" })).toBeCloseTo(1768.75 - 166, 6);
    expect(restingBurn({ ...sample, gender: "other" })).toBeCloseTo(1768.75, 6);
    expect(restingBurn({ ...sample, gender: "prefer_not_to_say" })).toBeCloseTo(1768.75, 6);
  });

  it("daily burn = resting × the day's factor + the week's training spread over 7 days", () => {
    expect(dailyBurn(sample)).toBeCloseTo(2254.2857, 3);
    // No training: the day's factor alone.
    expect(dailyBurn({ ...sample, trainingDays: 0 })).toBeCloseTo(1768.75 * 1.2, 6);
    expect(dailyBurn({ ...sample, trainingDays: 3, sessionMinutes: 0 })).toBeCloseTo(1768.75 * 1.2, 6);
    // Three 45-minute sessions add 131.79 a day; a very active day lifts the base.
    expect(dailyBurn(sample) - dailyBurn({ ...sample, trainingDays: 0 })).toBeCloseTo(131.7857, 3);
    expect(dailyBurn({ ...sample, dayActivity: "very_active", trainingDays: 0 })).toBeCloseTo(1768.75 * 1.6, 6);
  });

  it("the worked example: calories, macros, change, finish date", () => {
    const plan = computePlan(sample);
    expect(plan).toEqual({
      restingBurnKcal: 1769,
      dailyBurnKcal: 2254,
      targetKcal: 1704,
      dailyChangeKcal: -550,
      proteinG: 164,
      carbsG: 156,
      fatG: 47,
      plannedTargetKg: 75,
      daysToTarget: 98,
      finishDate: "2026-12-15",
      flags: [],
    });
  });

  it("is a pure function of its inputs: same answers, same numbers", () => {
    expect(computePlan(sample)).toEqual(computePlan({ ...sample }));
    expect(computePlan({ ...sample, today: "2027-01-01" }).finishDate).toBe("2027-04-09");
  });

  it("maintain: eat what you burn, no finish date, 1.6 g protein per kilo", () => {
    const plan = computePlan({ ...sample, goal: "maintain", targetWeightKg: null, pace: null });
    expect(plan.targetKcal).toBe(2254);
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

  it("carbohydrates never drop below 50 g even when protein and fat fill the calories", () => {
    // 150 kg at 2 g/kg = 300 g protein = 1200 kcal alone.
    const plan = computePlan({ ...sample, weightKg: 150, targetWeightKg: 140, dayActivity: "sitting", trainingDays: 0, pace: "brisk" });
    expect(plan.carbsG).toBeGreaterThanOrEqual(50);
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

  it("a target below the healthy floor is named and the plan runs to the floor instead", () => {
    const plan = computePlan({ ...sample, targetWeightKg: 50 });
    expect(plan.flags).toEqual([{ code: "target_below_healthy_weight", floorKg: 56.7 }]);
    expect(plan.plannedTargetKg).toBeCloseTo(56.65625, 6);
    // 25.34375 kg at 550 a day.
    expect(plan.daysToTarget).toBe(Math.ceil((25.34375 * 7700) / 550)); // 355
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
    // female 25 · 150 cm · 60 kg · sitting · no training: resting 1251.5, burn 1501.8,
    // so only 301.8 a day sits above the floor. 15 kg at gentle (275) = 420 days;
    // steady and brisk are both cut to 301.8 a day = 383 days — over a year at
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
    // female 25 · 155 cm · 50 kg · sitting · no training: resting 1182.75, burn 1419.3.
    // brisk asks 825 a day; only 219.3 is above the floor.
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
    expect(plan.dailyBurnKcal).toBe(1419);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(1200 - 1419);
    expect(plan.flags).toContainEqual({ code: "calorie_floor_applied", floorKcal: 1200 });
    // 5 kg at 219.3 a day = 175.6 → 176 days, not the 47 brisk would have promised.
    expect(plan.daysToTarget).toBe(176);
    expect(plan.finishDate).toBe(addDays("2026-09-08", 176));
  });

  it("calorie floor: a burn already under 1200 eats 1200, and a cut is impossible", () => {
    // female 60 · 130 cm · 35 kg · sitting · no training: resting 701.5, burn 841.8.
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
    expect(plan.plannedTargetKg).toBe(35);
    expect(plan.flags).toContainEqual({ code: "calorie_floor_applied", floorKcal: 1200 });
    expect(plan.flags).not.toContainEqual({ code: "pace_over_a_year", suggestedPace: null });
  });

  it("calorie floor holds for maintain and gain too", () => {
    const small = { ...sample, gender: "female" as const, age: 60, heightCm: 130, weightKg: 35, trainingDays: 0 };
    const keep = computePlan({ ...small, goal: "maintain", targetWeightKg: null, pace: null });
    expect(keep.targetKcal).toBe(1200);
    expect(keep.flags).toEqual([{ code: "calorie_floor_applied", floorKcal: 1200 }]);
    const gain = computePlan({ ...small, goal: "gain", targetWeightKg: 40, pace: "gentle" });
    expect(gain.targetKcal).toBeGreaterThanOrEqual(1200);
    expect(gain.daysToTarget).not.toBeNull();
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

  it("no calorie deficit in pregnancy or for a flagged heart, blood-pressure or diabetes answer", () => {
    for (const [key, reason] of [
      ["pregnant", "pregnancy"],
      ["heart", "heart"],
      ["bloodPressure", "blood_pressure"],
      ["diabetes", "diabetes"],
    ] as const) {
      const plan = computePlan({
        ...sample,
        health: { pregnant: false, heart: false, bloodPressure: false, diabetes: false, [key]: true },
      });
      expect(plan.flags).toEqual([{ code: "no_deficit", reasons: [reason] }]);
      expect(plan.dailyChangeKcal).toBe(0);
      expect(plan.daysToTarget).toBeNull();
    }
  });

  it("every reason is listed, in one fixed order", () => {
    const reasons = noDeficitReasons({
      age: 17,
      health: { pregnant: true, heart: true, bloodPressure: true, diabetes: true },
    });
    expect(reasons).toEqual(["under_18", "pregnancy", "heart", "blood_pressure", "diabetes"]);
    expect(noDeficitReasons({ age: 40, health: null })).toEqual([]);
  });

  it("an unanswered health screen applies no condition rule yet; the age rule needs no answer", () => {
    expect(computePlan({ ...sample, health: null }).flags).toEqual([]);
    expect(computePlan({ ...sample, health: null, age: 17 }).flags).toEqual([{ code: "no_deficit", reasons: ["under_18"] }]);
  });

  it("the rules only refuse a CUT: a gain or a maintain is untouched by them", () => {
    const flagged = { pregnant: true, heart: true, bloodPressure: true, diabetes: true };
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
});

describe("plan contract (@app/shared)", () => {
  it("calendar days must be real, zero-padded days", () => {
    expect(calendarDaySchema.safeParse("2026-09-08").success).toBe(true);
    expect(calendarDaySchema.safeParse("2028-02-29").success).toBe(true);
    expect(calendarDaySchema.safeParse("2026-02-30").success).toBe(false);
    expect(calendarDaySchema.safeParse("2026-9-8").success).toBe(false);
    expect(calendarDaySchema.safeParse("2026-09-08T00:00:00Z").success).toBe(false);
  });

  it("the app is for 16 and over; the rails match the profile's", () => {
    expect(planInputsSchema.safeParse({ ...sample, age: 15 }).success).toBe(false);
    expect(planInputsSchema.safeParse({ ...sample, age: 16 }).success).toBe(true);
    expect(planInputsSchema.safeParse({ ...sample, trainingDays: 8 }).success).toBe(false);
    expect(planInputsSchema.safeParse({ ...sample, extra: 1 }).success).toBe(false);
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
