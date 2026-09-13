// Onboarding v2 — the plan maths contract (RULINGS 2026-09-07, Onboarding; ROADMAP Stage 1 item 3a).
//
// The twelve screens send their answers so far; the server answers with the plan
// numbers or an honest list of what is still missing — never both, and never a
// number built from a default (RULINGS 2026-07-15: unanswered is not "beginner").
// So the number first exists once the eight core answers are in — after "your
// week" (screen 6); before that the screens show no number box (Kd, 2026-09-10). From
// screen 6 on, every answer changes the number (RULINGS 2026-09-07).
// The calculator itself lives in apps/api/src/modules/plan/maths.ts and is pure:
// it reads no clock, so "today" is an input — the route (item 4a) derives it from
// the device's time zone and the server clock, never from a body field.
import { z } from "zod";
import { genderSchema, weightGoalSchema, type WeightGoal } from "./users.js";

/** What the person wants their weight to do: screen 1's weight choice, stored
 *  as it is asked (RULINGS 2026-09-10), so the screens and the maths share one
 *  enum and nothing maps one to the other. */
export const planGoalSchema = weightGoalSchema;
export type PlanGoal = WeightGoal;

/** How fast, in the person's words; the kg-a-week behind each is in the calculator. */
export const planPaceSchema = z.enum(["gentle", "steady", "brisk"]);
export type PlanPace = z.infer<typeof planPaceSchema>;

/** How fast each pace moves the weight, in kg a week: one table, read by the
 *  plan maths and by the screen that offers the choice. The same table serves
 *  losing and gaining. */
export const PACE_KG_PER_WEEK: Readonly<Record<PlanPace, number>> = {
  gentle: 0.25,
  steady: 0.5,
  brisk: 0.75,
};

/** One kilogram of body weight is about 7 700 kcal — the usual planning figure
 *  (Wishnofsky: 3 500 kcal a pound). */
export const KCAL_PER_KG = 7700;

/** The whole kcal a day a pace asks for — a cut on a loss, a surplus on a gain:
 *  kg a week × kcal per kg ÷ 7 days. The plan maths and screen 3's pace cards
 *  share this one sum. */
export function paceDailyKcal(pace: PlanPace): number {
  return Math.round((PACE_KG_PER_WEEK[pace] * KCAL_PER_KG) / 7);
}

/** A daily cut larger than this mostly stops the muscle training builds: "an
 *  energy deficit of ~500 kcal · day⁻¹ prevented gains in LM" (Murphy and
 *  Koehler, 2022, a meta-analysis and meta-regression of trials that trained in
 *  a deficit for three weeks or more). With Build muscle ticked, a plan that cuts
 *  more says so and suggests a pace that cuts less; the number itself is never
 *  changed for it, because the weight choice alone sets the calories (RULINGS
 *  2026-09-10 and 2026-09-13). */
export const MUSCLE_GAIN_CUT_LIMIT_KCAL = 500;

/** The fastest pace whose cut stays within MUSCLE_GAIN_CUT_LIMIT_KCAL, or null
 *  when none does: the pace the plan suggests to someone building muscle while
 *  losing weight, and the pace card screen 3 marks for them. */
export const MUSCLE_GAIN_PACE: PlanPace | null =
  planPaceSchema.options
    .filter((pace) => paceDailyKcal(pace) <= MUSCLE_GAIN_CUT_LIMIT_KCAL)
    .sort((a, b) => paceDailyKcal(b) - paceDailyKcal(a))[0] ?? null;

/** Screen 4 ("your day"): what the day looks like OUTSIDE training. Training is
 *  added on top from the week's answers, so these factors are the no-exercise ones. */
export const dayActivitySchema = z.enum(["sitting", "on_feet", "active", "very_active"]);
export type DayActivity = z.infer<typeof dayActivitySchema>;

/** The health facts the maths needs (screen 8), both derived by the server from
 *  the stored screening (`health.ts`): ONE general question, never a condition
 *  by name (Kd, 2026-09-09). `hasCondition` — any yes — removes the calorie
 *  deficit, cleared or not; `safeMode` (a yes with "not yet") is listed as its
 *  own reason so the screen can say why. Absent until the health screen is
 *  answered; the age rule needs no health answer, it comes from screen 2. */
export const planHealthSchema = z
  .object({
    hasCondition: z.boolean(),
    safeMode: z.boolean(),
  })
  .strict()
  .refine((h) => !h.safeMode || h.hasCondition, { message: "safeMode needs a yes" });
export type PlanHealth = z.infer<typeof planHealthSchema>;

/** A calendar day, YYYY-MM-DD, in the person's own time zone (RULINGS 2026-07-21:
 *  the zone comes from the device; day maths never uses the server's clock). */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, "not a real calendar day");

/** The day a plan starts on: a real day with room for the ten-year horizon to
 *  stay inside four-digit years, so a finish date always fits `calendarDaySchema`. */
export const planStartDaySchema = calendarDaySchema.refine(
  (s) => s >= "2000-01-01" && s <= "9989-12-31",
  "year out of range",
);

/** Everything the calculator can act on. Every field is required here; the
 *  answers-so-far shape below is the one the screens send. Bounds are the same
 *  rails the fitness profile already uses (two decimals, as the columns store);
 *  age is 16 and over (RULINGS 2026-09-07). */
export const planInputsSchema = z
  .object({
    goal: planGoalSchema,
    age: z.number().int().min(16).max(120),
    gender: genderSchema,
    heightCm: z.number().min(50).max(300).multipleOf(0.01),
    weightKg: z.number().positive().lt(1000).multipleOf(0.01),
    /** Ignored for "maintain": the target is the current weight. */
    targetWeightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable(),
    /** Ignored for "maintain". */
    pace: planPaceSchema.nullable(),
    dayActivity: dayActivitySchema,
    trainingDays: z.number().int().min(0).max(7),
    sessionMinutes: z.number().int().min(0).max(240),
    health: planHealthSchema.nullable(),
    /** Build muscle is among screen 1's "also work on" goals. It raises protein
     *  to BUILD_MUSCLE_PROTEIN_G_PER_KG whatever the weight choice, and it is
     *  the only goal on that list the maths reads (RULINGS 2026-09-11:
     *  building muscle is not gaining weight). */
    buildMuscle: z.boolean(),
    today: planStartDaySchema,
  })
  .strict();
export type PlanInputs = z.infer<typeof planInputsSchema>;

/** The answers so far: any field may still be unanswered. */
export const planAnswersSchema = planInputsSchema
  .omit({ today: true })
  .partial()
  .extend({ today: planStartDaySchema })
  .strict();
export type PlanAnswers = z.infer<typeof planAnswersSchema>;

/** The answers the calculator refuses to work without. `targetWeightKg` and
 *  `pace` are only missing when the goal needs them; `health` is never missing
 *  (an unanswered health screen simply applies no condition rule yet). */
export const missingPlanInputSchema = z.enum([
  "goal",
  "age",
  "gender",
  "heightCm",
  "weightKg",
  "targetWeightKg",
  "pace",
  "dayActivity",
  "trainingDays",
  "sessionMinutes",
]);
export type MissingPlanInput = z.infer<typeof missingPlanInputSchema>;

/** Why the plan holds no calorie cut: under 18 · a yes on the health question
 *  (a condition, an injury, pregnancy or anything else) · Safe mode on top of
 *  that yes (RULINGS 2026-09-07, amended 2026-09-09). */
export const noDeficitReasonSchema = z.enum(["under_18", "health_answer", "safe_mode"]);
export type NoDeficitReason = z.infer<typeof noDeficitReasonSchema>;

/** The sanity rules, each a fact the screen can show in plain words. */
export const planFlagSchema = z.discriminatedUnion("code", [
  /** The target is on the wrong side of the current weight for the goal, or equal to it. */
  z.object({ code: z.literal("target_wrong_direction") }).strict(),
  /** The target is below the lowest healthy weight for the height. The plan runs to that
   *  floor instead (`plannedTargetKg` is `floorKg`) unless the weight cannot move — the
   *  person is already at or under the floor, a no-deficit rule applies, or
   *  `target_out_of_reach` is listed too — in which case the plan holds the current weight. */
  z.object({ code: z.literal("target_below_healthy_weight"), floorKg: z.number() }).strict(),
  /** At this pace the target is more than a year away. `suggestedPace` is the gentlest
   *  pace that finishes within a year, or null when no pace does. */
  z.object({ code: z.literal("pace_over_a_year"), suggestedPace: planPaceSchema.nullable() }).strict(),
  /** Calories would have gone under the floor and sit on it instead. If the plan still
   *  moves the weight it does so slower than the pace asked for (see `daysToTarget`);
   *  if the floor left no cut at all, `target_out_of_reach` is listed as well. */
  z.object({ code: z.literal("calorie_floor_applied"), floorKcal: z.number().int() }).strict(),
  /** No calorie deficit, by rule: calories stay at daily burn. */
  z.object({ code: z.literal("no_deficit"), reasons: z.array(noDeficitReasonSchema).min(1) }).strict(),
  /** The target cannot be reached at these calories, so the plan holds the current
   *  weight: on a "lose" goal the calorie floor left no cut (daily burn is at or
   *  under the floor); on a "gain" goal the target is more than ten years away at
   *  the fastest pace. No finish date; `plannedTargetKg` is the current weight. */
  z.object({ code: z.literal("target_out_of_reach") }).strict(),
  /** Build muscle is ticked and the plan cuts more than `limitKcal` a day
   *  (MUSCLE_GAIN_CUT_LIMIT_KCAL), which mostly stops muscle growing, so the
   *  plan keeps muscle more than it builds it. The calories are not changed for
   *  it. `suggestedPace` is MUSCLE_GAIN_PACE: the fastest pace that cuts no more
   *  than the limit, or null when none does. */
  z
    .object({ code: z.literal("cut_limits_muscle_gain"), limitKcal: z.number().int(), suggestedPace: planPaceSchema.nullable() })
    .strict(),
]);
export type PlanFlag = z.infer<typeof planFlagSchema>;

/** Mifflin-St Jeor's constant in each version of the formula: one table, read
 *  by the calculator and by the check on its working below. */
export const MIFFLIN_ST_JEOR_CONSTANT: Readonly<Record<"female" | "male", number>> = {
  female: -161,
  male: 5,
};

/** Protein is counted on the body weight, but never on more than the weight at
 *  this BMI for the height (Kd, 2026-09-11). Protein needs follow muscle more
 *  than body weight, so a heavy body counted whole is handed a target nobody
 *  eats (240 g a day for 120 kg at 175 cm); guidance for heavier bodies counts
 *  them "with a maximum weight of BMI 30" (Weijs, 2025). */
export const PROTEIN_REFERENCE_BMI = 30;

/** The weight protein is counted on, to two decimals as weights are stored, and
 *  the reference BMI when that cap is what was counted (null when it is the body
 *  weight itself). The calculator and the check on its working share this sum. */
export function proteinWeight(weightKg: number, heightCm: number): { kg: number; referenceBmi: number | null } {
  const m = heightCm / 100;
  const capKg = Math.round(PROTEIN_REFERENCE_BMI * m * m * 100) / 100;
  return weightKg > capKg ? { kg: capKg, referenceBmi: PROTEIN_REFERENCE_BMI } : { kg: weightKg, referenceBmi: null };
}

/** Grams of protein per kilo, at the least, while Build muscle is ticked,
 *  whatever the weight choice (the gain figure is the same): "~2.2 g
 *  protein/kg/d for those seeking to maximise resistance training-induced
 *  gains in FFM" (Morton and colleagues, 2018, a meta-analysis of 49 studies). */
export const BUILD_MUSCLE_PROTEIN_G_PER_KG = 2.2;

/** How the number was reached, one step per line of "How is this worked out?"
 *  under the daily number (Kd, 2026-09-10). The server sends every figure the
 *  steps use — only it knows the day factor, the training figure and the
 *  protein table — and the screen adds the words and the sources. Every kcal
 *  and gram is whole. The refine on `planNumbersSchema` checks each line's own
 *  product and sum against the plan's numbers, and each figure the plan panel
 *  prints on more than one line against its twin: the weight (and the weight
 *  protein is counted on, which follows from it and the height), the formula's
 *  constant, the pace's kilos a week, the kcal per kilo, the kilos to move and
 *  the two floors the flags name. So a working that does not multiply out, add
 *  up or agree with itself is refused on both sides of the wire. */
export const planWorkingsSchema = z
  .object({
    /** Mifflin-St Jeor: 10 × weight + 6.25 × height − 5 × age + `constant`,
     *  rounded. `formula` names the version used: the women's (−161) for a
     *  female answer, the men's (+5) for every other answer. */
    resting: z
      .object({
        formula: z.enum(["female", "male"]),
        weightKg: z.number(),
        heightCm: z.number(),
        age: z.number().int(),
        constant: z.number().int(),
        kcal: z.number().int(),
      })
      .strict(),
    /** The day outside training: resting × `factor`, rounded. */
    day: z.object({ activity: dayActivitySchema, factor: z.number(), kcal: z.number().int() }).strict(),
    /** Training spread over the week: kcal per kg per hour × weight × the
     *  week's minutes ÷ 60 ÷ 7 days, rounded. */
    training: z
      .object({
        kcalPerKgHour: z.number(),
        weightKg: z.number(),
        trainingDays: z.number().int(),
        sessionMinutes: z.number().int(),
        kcal: z.number().int(),
      })
      .strict(),
    /** What the pace asks for a day — kg a week × kcal per kg ÷ 7, negative for
     *  a cut — or null when the plan holds the weight (the flags say why). */
    change: z
      .object({ pace: planPaceSchema, kgPerWeek: z.number(), kcalPerKg: z.number().int(), kcal: z.number().int() })
      .strict()
      .nullable(),
    /** Burn plus the change, before the calorie floor. */
    beforeFloorKcal: z.number().int(),
    floorKcal: z.number().int(),
    /** Grams per kg for the goal × the weight protein is counted on, rounded:
     *  the body weight, or for a body heavier than `referenceBmi` for its
     *  height the weight at that BMI (`proteinWeight`); `referenceBmi` is null
     *  when the body weight is what was counted. `buildMuscle` is true while
     *  Build muscle is ticked, which raises the figure to at least
     *  BUILD_MUSCLE_PROTEIN_G_PER_KG, so the screen can name that source.
     *  `proteinG` is smaller only when the carbohydrate floor made protein
     *  give way. */
    protein: z
      .object({
        gPerKg: z.number(),
        weightKg: z.number(),
        referenceBmi: z.number().nullable(),
        wantedG: z.number().int(),
        buildMuscle: z.boolean(),
      })
      .strict(),
    /** Fat's share of the calories, at 9 kcal a gram. */
    fatShare: z.number(),
    /** Carbohydrates take the rest, at 4 kcal a gram, never under this. */
    carbsFloorG: z.number().int(),
    /** The finish date's working: kg to move × kcal per kg ÷ the daily change,
     *  rounded up to a whole day. Null exactly when there is no date. */
    finish: z.object({ kgToMove: z.number(), kcalPerKg: z.number().int() }).strict().nullable(),
  })
  .strict();
export type PlanWorkings = z.infer<typeof planWorkingsSchema>;

/** Whole days to move `kgToMove` at `dailyChangeKcal` a day, counted in whole
 *  hundredths of a kilo. The weights carry two decimals, and their
 *  floating-point difference can carry a crumb (64.01 − 63.01 is
 *  1.0000000000000142) that rounds an exact number of days UP by one. The
 *  calculator and the check below share this one sum. */
export function daysToMove(kgToMove: number, kcalPerKg: number, dailyChangeKcal: number): number {
  return Math.ceil((Math.round(kgToMove * 100) * kcalPerKg) / (100 * Math.abs(dailyChangeKcal)));
}

/** The kilos between two weights. Both carry two decimals, so the distance is
 *  kept to two as well. The calculator and the check below share this one sum. */
export function kgBetween(aKg: number, bKg: number): number {
  return Math.round(Math.abs(aKg - bKg) * 100) / 100;
}

export const planNumbersSchema = z
  .object({
    /** Resting burn (Mifflin-St Jeor), kcal a day. */
    restingBurnKcal: z.number().int(),
    /** Resting burn × the day's factor + the week's training spread over seven days. */
    dailyBurnKcal: z.number().int(),
    /** Calories to eat a day; never under the floor. */
    targetKcal: z.number().int(),
    /** Exactly targetKcal − dailyBurnKcal, so the two numbers on screen subtract to it.
     *  Negative on a cut, positive on a gain or when the floor sits above the burn. */
    dailyChangeKcal: z.number().int(),
    /** The three add up to targetKcal (to rounding); carbohydrates never under 50 g. */
    proteinG: z.number().int(),
    carbsG: z.number().int(),
    fatG: z.number().int(),
    /** The weight the plan actually runs to (the current weight for "maintain" or
     *  when the plan cannot move the weight; the healthy-weight floor, to one
     *  decimal, when the target sat below it). */
    plannedTargetKg: z.number(),
    /** Days until the planned target, re-derivable from the screen's numbers
     *  (kg to move × 7 700 ÷ |dailyChangeKcal|, rounded up); null when the plan does
     *  not move the weight. Never more than ten years. */
    daysToTarget: z.number().int().nullable(),
    finishDate: calendarDaySchema.nullable(),
    flags: z.array(planFlagSchema),
    /** How the numbers above were reached, step by step. */
    workings: planWorkingsSchema,
  })
  .strict()
  .refine(
    (p) => {
      // Every line "How is this worked out?" prints: each product as the
      // calculator rounds it (the same expressions, so the same floating
      // point), then each sum against the plan's own numbers, then each figure
      // the panel prints on two lines against its twin.
      const w = p.workings;
      const r = w.resting;
      const t = w.training;
      const counted = proteinWeight(r.weightKg, r.heightCm);
      return (
        r.kcal === Math.round(10 * r.weightKg + 6.25 * r.heightCm - 5 * r.age + r.constant) &&
        w.day.kcal === Math.round(r.kcal * w.day.factor) &&
        t.kcal === Math.round((t.kcalPerKgHour * t.weightKg * ((t.sessionMinutes * t.trainingDays) / 60)) / 7) &&
        (w.change === null || Math.abs(w.change.kcal) === Math.round((w.change.kgPerWeek * w.change.kcalPerKg) / 7)) &&
        w.protein.wantedG === Math.round(w.protein.weightKg * w.protein.gPerKg) &&
        r.kcal === p.restingBurnKcal &&
        w.day.kcal + w.training.kcal === p.dailyBurnKcal &&
        w.beforeFloorKcal === p.dailyBurnKcal + (w.change?.kcal ?? 0) &&
        p.targetKcal === Math.max(w.beforeFloorKcal, w.floorKcal) &&
        p.dailyChangeKcal === p.targetKcal - p.dailyBurnKcal &&
        p.proteinG <= w.protein.wantedG &&
        p.fatG === Math.round((p.targetKcal * w.fatShare) / 9) &&
        p.carbsG >= w.carbsFloorG &&
        (w.finish === null) === (p.daysToTarget === null) &&
        (w.finish === null || p.daysToTarget === daysToMove(w.finish.kgToMove, w.finish.kcalPerKg, p.dailyChangeKcal)) &&
        // The weight on the resting and training lines, and in "Keeps your
        // weight at …" when the plan holds it.
        t.weightKg === r.weightKg &&
        (p.daysToTarget !== null || p.plannedTargetKg === r.weightKg) &&
        // The protein line's weight: the resting line's, or the weight at the
        // reference BMI for its height when the body is heavier.
        w.protein.weightKg === counted.kg &&
        w.protein.referenceBmi === counted.referenceBmi &&
        // With Build muscle ticked, never under its figure.
        (!w.protein.buildMuscle || w.protein.gPerKg >= BUILD_MUSCLE_PROTEIN_G_PER_KG) &&
        // The version of the formula the resting line names, and its constant.
        r.constant === MIFFLIN_ST_JEOR_CONSTANT[r.formula] &&
        // The pace line's kilos a week, as screen 3 offers that pace.
        (w.change === null || w.change.kgPerWeek === PACE_KG_PER_WEEK[w.change.pace]) &&
        // The finish line: the kilos between the weight and "Reach …", and the
        // pace line's kcal per kilo.
        (w.finish === null || w.finish.kgToMove === kgBetween(p.plannedTargetKg, r.weightKg)) &&
        (w.finish === null || w.change === null || w.finish.kcalPerKg === w.change.kcalPerKg) &&
        // The flags' figures: the floor "To eat" names, the healthy weight a
        // dated plan runs to, and the cut the muscle line names — raised only
        // with Build muscle ticked and a cut over it, and suggesting the one
        // pace screen 3 marks.
        p.flags.every(
          (flag) =>
            (flag.code !== "calorie_floor_applied" || flag.floorKcal === w.floorKcal) &&
            (flag.code !== "target_below_healthy_weight" || p.daysToTarget === null || flag.floorKg === p.plannedTargetKg) &&
            (flag.code !== "cut_limits_muscle_gain" ||
              (flag.limitKcal === MUSCLE_GAIN_CUT_LIMIT_KCAL &&
                flag.suggestedPace === MUSCLE_GAIN_PACE &&
                w.protein.buildMuscle &&
                -p.dailyChangeKcal > flag.limitKcal)),
        )
      );
    },
    { message: "the working must add up to the plan's own numbers" },
  );
export type PlanNumbers = z.infer<typeof planNumbersSchema>;

/** `plan` is null EXACTLY when `missing` is non-empty — enforced here so every
 *  caller gets the guarantee, as the nutrition targets response already does. */
export const planResponseSchema = z
  .object({
    plan: planNumbersSchema.nullable(),
    missing: z.array(missingPlanInputSchema),
  })
  .strict()
  .refine((r) => (r.plan === null) === (r.missing.length > 0), {
    message: "plan must be null exactly when missing is non-empty",
  });
export type PlanResponse = z.infer<typeof planResponseSchema>;
