import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarDaySchema,
  missingPlanInputSchema,
  planAnswersSchema,
  planHealthSchema,
  planInputsSchema,
  planResponseSchema,
  planStartDaySchema,
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
  computePlan,
  dailyBurn,
  healthyWeightFloorKg,
  macrosFor,
  missingPlanInputs,
  noDeficitReasons,
  resolvePlan,
  restingBurn,
} from "../src/modules/plan/maths.js";

// The worked example every golden below is hand-computed from:
//   resting burn  = 10·82 + 6.25·175 − 5·30 + 5            = 1768.75
//   training      = 5 MET · 82 kg · 0.75 h · 3 days / 7    = 131.7857…
//   daily burn    = 1768.75 · 1.2 + 131.7857               = 2254.2857… → 2254 (whole kcal from here on)
//   steady cut    = 0.5 kg/wk · 7700 / 7                   = 550 a day
//   eat           = 2254 − 550                             = 1704
//   days          = ⌈7 kg · 7700 / 550⌉                    = 98 → 2026-12-15
//   protein 82·2 = 164 · fat 1704·0.25/9 = 47.33 → 47 · carbs (1704 − 656 − 426)/4 = 155.5 → 156
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
  if (plan.daysToTarget !== null) {
    check("inside the horizon", plan.daysToTarget <= MAX_PLAN_DAYS);
    check("days re-derivable", plan.daysToTarget === Math.ceil((Math.abs(plan.plannedTargetKg - body.weightKg) * KCAL_PER_KG) / Math.abs(plan.dailyChangeKcal)));
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
  today: "2026-09-08",
};

describe("plan maths — the numbers (Stage 1 item 3a)", () => {
  it("pins the tables the numbers come from", () => {
    expect(KCAL_PER_KG).toBe(7700);
    expect(CALORIE_FLOOR_KCAL).toBe(1200); // nutrition/targets.ts:167
    expect(ADULT_AGE).toBe(18);
    expect(HEALTHY_BMI_FLOOR).toBe(18.5);
    expect(ONE_YEAR_DAYS).toBe(365);
    expect(MAX_PLAN_DAYS).toBe(3650);
    expect(TRAINING_MET).toBe(5);
    expect(FAT_SHARE).toBe(0.25);
    expect(CARBS_FLOOR_G).toBe(50);
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
      for (const weightKg of weights) for (const dayActivity of days) for (const week of weeks) for (const health of healths) {
        const base = { goal, gender, age, heightCm, weightKg, dayActivity, ...week, health, today: "2026-09-08" };
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
    // female 20 · 155 cm · 44.6 kg · no training: resting 1153.75, burn 1384.5 → 1385; eat 1200.
    // The raw difference −184.5 rounds to −184 (the review's finding); the screen subtracts −185.
    const plan = computePlan({ ...sample, gender: "female", age: 20, heightCm: 155, weightKg: 44.6, targetWeightKg: 40, trainingDays: 0 });
    expect(plan.dailyBurnKcal).toBe(1385);
    expect(plan.targetKcal).toBe(1200);
    expect(plan.dailyChangeKcal).toBe(-185);
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

  it("carbohydrates never drop below 50 g: protein gives way so the grams still make the calories", () => {
    // female 80 · 140 cm · 150 kg · sitting · no training: resting 1814, burn 2176.8 → 2177;
    // brisk −825 = 1352. 2 g/kg would be 300 g protein (1200 kcal) + 37.6 g fat (338) — more
    // than the day holds. Fat keeps its share, carbs take the floor, protein takes the rest.
    const plan = computePlan({ ...sample, gender: "female", age: 80, heightCm: 140, weightKg: 150, targetWeightKg: 140, trainingDays: 0, pace: "brisk" });
    expect(plan.targetKcal).toBe(1352);
    expect(plan.fatG).toBe(Math.round((1352 * 0.25) / 9)); // 38
    expect(plan.carbsG).toBe(50);
    expect(plan.proteinG).toBe(Math.round((1352 - 200 - 1352 * 0.25) / 4)); // 204, not 300
    // Three roundings can drift the sum by at most 2 + 2 + 4.5 kcal.
    expect(Math.abs(plan.proteinG * 4 + plan.carbsG * 4 + plan.fatG * 9 - 1352)).toBeLessThanOrEqual(9);
    // A body the table fits keeps its full protein and carbs above the floor.
    expect(macrosFor(1704, 82, 2)).toEqual({ proteinG: 164, carbsG: 156, fatG: 47 });
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
    expect(plan.finishDate).toBeNull();
    expect(plan.plannedTargetKg).toBe(35);
    expect(plan.flags).toEqual([
      { code: "target_below_healthy_weight", floorKg: 31.3 },
      { code: "calorie_floor_applied", floorKcal: 1200 },
      { code: "target_out_of_reach" },
    ]);
  });

  it("the floor leaves a cut of exactly nothing: no date in the year 4417, the target is out of reach", () => {
    // female 60 · 140 cm · 58.61 kg · sitting · no training: resting 1000.1, burn 1200.12 → 1200.
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
    // female 60 · 150 cm · 45 kg → 42 (above the 41.6 floor) · sitting · no training: resting 926.5,
    // burn 1111.8 → 1112; 1200 is 88 above it. The plan holds the weight and says why.
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
    // male 30 · 175 cm · 60 kg gaining at brisk (825 a day): burn 1954.9 → 1955.
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

  it("the contract refuses Safe mode without a yes � the two facts cannot contradict", () => {
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
