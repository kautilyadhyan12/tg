// Onboarding v2 — the answers the screens save, and the live plan the server
// answers with (ROADMAP Stage 1 item 4a, server half).
//
// RULINGS 2026-09-07: twelve tap-only screens, saved as you go, and every answer
// changes the plan number on screen. RULINGS 2026-09-10 (goals, built in
// 4a-iv): screen 1 asks ONE weight choice — lose · keep · gain — which alone
// sets the calorie number and is stored as the direction the maths works in,
// plus "also work on", any number of goals, none of which moves the calories.
// Building muscle is one of those, not a weight choice (RULINGS 2026-09-11). A
// contradiction cannot be picked: there is one weight choice, and nothing on
// the list fights it or another goal. Screen 5 asks push-ups and plank beside
// the self-rating, and either may be left "Not sure", so neither is required.
//
// SAVE AS YOU GO means PATCH semantics: a field that is absent is left alone,
// and an explicit null clears it. That is the opposite of the full-document PUT
// on the fitness profile, which is Settings' route. The two share the columns
// both ask (screen 1's two questions among them) and each leaves the rest alone.
import { z } from "zod";
import { dayActivitySchema, missingPlanInputSchema, planNumbersSchema, planPaceSchema } from "./plan.js";
import {
  dietSchema,
  displayNameSchema,
  equipmentArraySchema,
  equipmentSchema,
  fitnessGoalSchema,
  fitnessGoalsArraySchema,
  fitnessLevelSchema,
  genderSchema,
  mealsPerDaySchema,
  weightGoalSchema,
} from "./users.js";

/** Screen 5's two checks. Both nullable: "skip, I'll rate myself" leaves them
 *  empty, and an empty check is never an input to the calorie plan — it sets
 *  the first week's workout numbers, which the plan builder (6a) reads. */
const pushUpsMaxSchema = z.number().int().min(0).max(500);
const plankHoldSecondsSchema = z.number().int().min(0).max(3600);

/** The rails the columns already carry, kept identical so one answer cannot
 *  mean two things: training days and session minutes ARE the profile's
 *  `exercise_frequency` and `session_duration_min` (renamed on this surface to
 *  the words the plan contract and the screens use). */
const trainingDaysSchema = z.number().int().min(1).max(7);
const sessionMinutesSchema = z.number().int().min(5).max(240);

/** Everything the twelve screens have answered so far. Every field is nullable:
 *  a half-finished wizard is the normal state, and unanswered is never a
 *  default (RULINGS 2026-07-15). `weightKg` is the newest weigh-in — the only
 *  place body weight lives (RULINGS 2026-09-10); screen 2 asks it, and what
 *  is typed there is saved as a weigh-in marked "typed by me". */
export const onboardingAnswersSchema = z
  .object({
    /** What the app calls the person — the account's own name, which screen 2
     *  asks first (Kd, 2026-09-10). Never empty: a code sign-in starts it at
     *  the email's first part, Google at the Google name. */
    displayName: z.string(),
    /** Screen 1: the weight choice, and the goals to work on beside it. */
    weightGoal: weightGoalSchema.nullable(),
    fitnessGoals: z.array(fitnessGoalSchema),
    age: z.number().int().nullable(),
    gender: genderSchema.nullable(),
    heightCm: z.number().nullable(),
    weightKg: z.number().nullable(),
    targetWeightKg: z.number().nullable(),
    pace: planPaceSchema.nullable(),
    dayActivity: dayActivitySchema.nullable(),
    fitnessLevel: fitnessLevelSchema.nullable(),
    pushUpsMax: z.number().int().nullable(),
    plankHoldSeconds: z.number().int().nullable(),
    trainingDays: z.number().int().nullable(),
    sessionMinutes: z.number().int().nullable(),
    availableEquipment: z.array(equipmentSchema),
    /** Screen 9's two answers. Neither moves a calorie: the meal ideas after a
     *  workout follow the diet, the meal suggestions (7a) will read both, and
     *  the plan number never does. */
    diet: dietSchema.nullable(),
    mealsPerDay: z.number().int().nullable(),
    onboardingCompleted: z.boolean(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

/** The query both onboarding routes take. `timeZone` is the DEVICE's IANA
 *  zone (RULINGS 2026-07-21); the day itself is never accepted from a client.
 *  Whether the runtime knows the zone is the server's check, not a shape. */
export const onboardingQuerySchema = z
  .object({ timeZone: z.string().trim().min(1).max(64).optional() })
  .strict();
export type OnboardingQuery = z.infer<typeof onboardingQuerySchema>;

/** One screen's save. Every field optional — the screen sends only what it
 *  asked. An empty body is allowed and simply re-reads the plan: a screen whose
 *  every answer was skipped must not be a 400.
 *
 *  `today` is NOT here and never will be. The day a plan starts on comes from
 *  the server clock read in the device's time zone (the `timeZone` query
 *  parameter), so a client cannot move its own finish date. */
export const patchOnboardingRequestSchema = z
  .object({
    /** The profile form's own rail. A name is changed, never cleared: no null. */
    displayName: displayNameSchema.optional(),
    weightGoal: weightGoalSchema.nullable().optional(),
    /** The whole list as it now stands: a tap sends all of it. */
    fitnessGoals: fitnessGoalsArraySchema.optional(),
    age: z.number().int().min(16).max(120).nullable().optional(),
    gender: genderSchema.nullable().optional(),
    heightCm: z.number().min(50).max(300).multipleOf(0.01).nullable().optional(),
    weightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
    targetWeightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
    pace: planPaceSchema.nullable().optional(),
    dayActivity: dayActivitySchema.nullable().optional(),
    fitnessLevel: fitnessLevelSchema.nullable().optional(),
    pushUpsMax: pushUpsMaxSchema.nullable().optional(),
    plankHoldSeconds: plankHoldSecondsSchema.nullable().optional(),
    trainingDays: trainingDaysSchema.nullable().optional(),
    sessionMinutes: sessionMinutesSchema.nullable().optional(),
    availableEquipment: equipmentArraySchema.optional(),
    diet: dietSchema.nullable().optional(),
    mealsPerDay: mealsPerDaySchema.nullable().optional(),
    onboardingCompleted: z.boolean().optional(),
  })
  .strict();
export type PatchOnboardingRequest = z.infer<typeof patchOnboardingRequestSchema>;

/** What both routes answer with: the answers as stored, and the plan those
 *  answers produce — or the honest list of what is still needed. `plan` is null
 *  EXACTLY when `missing` is non-empty, the same guarantee `planResponseSchema`
 *  gives, restated here because this response carries the answers too. */
export const onboardingResponseSchema = z
  .object({
    answers: onboardingAnswersSchema,
    plan: planNumbersSchema.nullable(),
    missing: z.array(missingPlanInputSchema),
  })
  .strict()
  .refine((r) => (r.plan === null) === (r.missing.length > 0), {
    message: "plan must be null exactly when missing is non-empty",
  });
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

/** What still stands between a person and the end of setup: everything the PLAN
 *  needs, plus the three answers no number depends on and setup does.
 *
 *  `health` is the one question on screen 8, which the plan can do without (an
 *  unanswered screening simply applies no condition rule, plan.ts) but setup
 *  cannot: it decides Safe mode and the calorie cut, so the training side never
 *  opens on a guess about it.
 *
 *  `diet` and `mealsPerDay` are screen 9's (4b-ii). The calorie number never
 *  reads them, and the meal suggestions (7a) cannot be made without them —
 *  guessing "non-vegetarian" would put meat in front of a vegetarian, which is
 *  the invented default RULINGS 2026-07-15 rules out. Every other screen is
 *  answered before a person may finish, and this one is too.
 *
 *  Screen 11, the gym code, is NOT here and never will be: most people have no
 *  code, so there is nothing to answer.
 *
 *  Written out rather than spread from `missingPlanInputSchema` so the enum
 *  stays a plain list; the shared test pins it to that schema's options plus
 *  the extras, so an input added to the plan cannot go missing here. */
export const missingSetupAnswerSchema = z.enum([
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
  "health",
  "diet",
  "mealsPerDay",
]);
export type MissingSetupAnswer = z.infer<typeof missingSetupAnswerSchema>;

/** The 409 a finish gets while setup still lacks an answer: onboarding comes
 *  before the training side (RULINGS 2026-07-19). `missing` names the questions
 *  still open, so the screen can send the person to them. */
export const onboardingIncompleteBodySchema = z
  .object({
    error: z.literal("onboarding_incomplete"),
    message: z.string(),
    requestId: z.string(),
    missing: z.array(missingSetupAnswerSchema).min(1),
  })
  .strict();
export type OnboardingIncompleteBody = z.infer<typeof onboardingIncompleteBodySchema>;
