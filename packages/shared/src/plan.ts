// Onboarding v2 — the plan maths contract (RULINGS 2026-09-07, Onboarding; ROADMAP Stage 1 item 3a).
//
// The twelve screens send their answers so far; the server answers with the plan
// numbers or an honest list of what is still missing — never both, and never a
// number built from a default (RULINGS 2026-07-15: unanswered is not "beginner").
// So the number first exists once the eight core answers are in — after "your
// week" (screen 6); screens 1–5 show what is still needed, in plain words. From
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

/** Screen 4 ("your day"): what the day looks like OUTSIDE training. Training is
 *  added on top from the week's answers, so these factors are the no-exercise ones. */
export const dayActivitySchema = z.enum(["sitting", "on_feet", "active", "very_active"]);
export type DayActivity = z.infer<typeof dayActivitySchema>;

/** The health answers the maths needs (screen 8). A "yes" here removes the calorie
 *  deficit (RULINGS 2026-09-07). Absent until the health screen is answered; the
 *  age rule needs no health answer, it comes from screen 2. */
export const planHealthSchema = z
  .object({
    pregnant: z.boolean(),
    heart: z.boolean(),
    bloodPressure: z.boolean(),
    diabetes: z.boolean(),
  })
  .strict();
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

/** Why the plan holds no calorie cut. */
export const noDeficitReasonSchema = z.enum(["under_18", "pregnancy", "heart", "blood_pressure", "diabetes"]);
export type NoDeficitReason = z.infer<typeof noDeficitReasonSchema>;

/** The sanity rules, each a fact the screen can show in plain words. */
export const planFlagSchema = z.discriminatedUnion("code", [
  /** The target is on the wrong side of the current weight for the goal, or equal to it. */
  z.object({ code: z.literal("target_wrong_direction") }).strict(),
  /** The target is below the lowest healthy weight for the height; the plan runs to that floor instead. */
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
  })
  .strict();
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
