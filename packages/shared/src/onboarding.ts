// Onboarding v2 — the answers the screens save, and the live plan the server
// answers with (ROADMAP Stage 1 item 4a, server half).
//
// RULINGS 2026-09-07: twelve tap-only screens, saved as you go, and every answer
// changes the plan number on screen. RULINGS 2026-09-09 (this card): screen 1
// asks for ONE main goal out of the seven the app already offers — not a
// multi-select, because two goals that fight (lose weight AND build muscle)
// cannot both be honoured by one calorie number. The weight direction the maths
// needs (lose / gain / keep) is DERIVED from that goal here, never asked.
// Screen 5 keeps the push-up and plank checks beside the self-rating, and both
// may be skipped ("I'll rate myself"), so neither is ever required.
//
// SAVE AS YOU GO means PATCH semantics: a field that is absent is left alone,
// and an explicit null clears it. That is the opposite of the old full-document
// PUT on the fitness profile, which is still the live v1 screen's route and is
// deliberately untouched here — the two write different columns.
import { z } from "zod";
import {
  dayActivitySchema,
  missingPlanInputSchema,
  planNumbersSchema,
  planPaceSchema,
  type PlanGoal,
} from "./plan.js";
import { equipmentSchema, fitnessGoalSchema, fitnessLevelSchema, genderSchema, type FitnessGoal } from "./users.js";

/** Screen 1: the ONE goal the person picks, from the seven the app already
 *  offers (the same value set the old multi-select used, so nothing the user
 *  could choose before has been taken away). */
export const mainGoalSchema = fitnessGoalSchema;
export type MainGoal = FitnessGoal;

/** THE mapping, in one place: a goal in the person's words → the direction the
 *  calorie maths works in. Only two goals move the weight on purpose; the other
 *  five hold it, which is why they never ask for a target weight or a pace.
 *  Kd, 2026-09-09: the direction is derived, never a question of its own. */
export const PLAN_GOAL_BY_MAIN_GOAL: Readonly<Record<MainGoal, PlanGoal>> = {
  weight_loss: "lose",
  muscle_gain: "gain",
  general_fitness: "maintain",
  flexibility: "maintain",
  endurance: "maintain",
  posture: "maintain",
  stress_relief: "maintain",
};

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
 *  default (RULINGS 2026-07-15). `weightKg` is read through from the users row,
 *  where it lives unduplicated — the screen asks it on screen 2 like any other. */
export const onboardingAnswersSchema = z
  .object({
    mainGoal: mainGoalSchema.nullable(),
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
    onboardingCompleted: z.boolean(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

/** A set, not a list (the fitness profile's rule): a repeated value is refused
 *  rather than silently deduped. */
const uniqueEquipment = z
  .array(equipmentSchema)
  .max(5)
  .refine((a) => new Set(a).size === a.length, { message: "duplicate values are not allowed" });

/** One screen's save. Every field optional — the screen sends only what it
 *  asked. An empty body is allowed and simply re-reads the plan: a screen whose
 *  every answer was skipped must not be a 400.
 *
 *  `today` is NOT here and never will be. The day a plan starts on comes from
 *  the server clock read in the device's time zone (the `timeZone` query
 *  parameter), so a client cannot move its own finish date. */
export const patchOnboardingRequestSchema = z
  .object({
    mainGoal: mainGoalSchema.nullable().optional(),
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
    availableEquipment: uniqueEquipment.optional(),
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
