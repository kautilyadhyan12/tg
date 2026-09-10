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
import { genderSchema } from "./users.js";

/** What the person wants their weight to do. Screen 1 ("goal") maps to this. */
export const planGoalSchema = z.enum(["lose", "gain", "maintain"]);
export type PlanGoal = z.infer<typeof planGoalSchema>;

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
]);
export type PlanFlag = z.infer<typeof planFlagSchema>;

/** How the number was reached, one step per line of "How is this worked out?"
 *  under the daily number (Kd, 2026-09-10). The server sends every figure the
 *  steps use — only it knows the day factor, the training figure and the
 *  protein table — and the screen adds the words and the sources. Every kcal
 *  and gram is whole, and every line the screen prints, each product and each
 *  sum, is checked by the refine on `planNumbersSchema` against the plan's own
 *  numbers, so a working that does not multiply out or add up is refused on
 *  both sides of the wire. */
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
    /** Grams per kg for the goal × weight, rounded. `proteinG` is smaller only
     *  when the carbohydrate floor made protein give way. */
    protein: z.object({ gPerKg: z.number(), weightKg: z.number(), wantedG: z.number().int() }).strict(),
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
      // point), then each sum against the plan's own numbers.
      const w = p.workings;
      const r = w.resting;
      const t = w.training;
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
        (w.finish === null || p.daysToTarget === daysToMove(w.finish.kgToMove, w.finish.kcalPerKg, p.dailyChangeKcal))
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
