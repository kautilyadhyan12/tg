// P2.2 — users/profile contracts (R7.2: every shape lives once, here).
// Full profile view (v1 §6.1 users module); the minimal auth view stays in
// auth.ts. All request bodies are .strict() (Part IV #5).
import { z } from "zod";
import { oneTimeTokenSchema, signInCodeSchema } from "./auth.js";

/** Part 4 §3.1 users columns exposed to the owner. emailVerified is DERIVED
 *  from a consumed verify_email one-time token (DECISIONS 2026-07-11). */
export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  locale: z.string(),
  units: z.string(),
  timezone: z.string().nullable(),
  /** The newest weigh-in (RULINGS 2026-09-10) — the only place weight lives. */
  weightKg: z.number().nullable(),
  leaderboardOptOut: z.boolean(),
  /** Onboarding gate (v1 §6.1:442 — a users-module concern, which is why it is
   *  absent from the auth view). Stored on user_fitness_profiles; false when
   *  the user has no profile row yet (onboarding-storage card). */
  onboardingCompleted: z.boolean(),
  createdAt: z.string(), // ISO timestamptz
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const userProfileResponseSchema = z.object({ user: userProfileSchema });
export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;

/** The name the app calls a person. One rail for every surface that writes
 *  it: the profile form, and onboarding's "What should we call you?". */
export const displayNameSchema = z.string().trim().min(1).max(100);

/** PATCH body: preference/display fields ONLY — server-owned fields (email,
 *  status, plan-adjacent anything) are not writable here (R3.1). Locale/units
 *  value sets recorded in DECISIONS (P2.2): locales = the spec's EN/HI/AS
 *  (Part 2 Appendix A localization triad); units = metric|imperial.
 *  weightKg bounds mirror body_measurements.weight_kg numeric(5,2) (Part 4
 *  §3.6): a weight sent here is saved as a weigh-in marked "typed by me", and
 *  the number the history already shows writes nothing. */
export const updateProfileRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    locale: z.enum(["en", "hi", "as"]).optional(),
    units: z.enum(["metric", "imperial"]).optional(),
    timezone: z.string().trim().min(1).max(64).nullable().optional(),
    weightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
    leaderboardOptOut: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "at least one field required" });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** Part 4 §5.2 Day-0 undo flow: the emailed one-time token restores the
 *  account within the 14-day window. */
export const restoreAccountRequestSchema = z.object({ token: oneTimeTokenSchema }).strict();
export type RestoreAccountRequest = z.infer<typeof restoreAccountRequestSchema>;

/** Deleting the account is confirmed with a 6-digit code emailed to the
 *  account's own address (there is no password to ask for since 2026-09-07). */
export const deleteAccountRequestSchema = z.object({ code: signInCodeSchema }).strict();
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

// ── onboarding / fitness profile (onboarding-storage card) ──────────────────
// v1 §6.1:442 puts onboarding data in the users module; Part 4 defines no
// storage, so P2.7 DROPped these fields (INVENTORY.md:45) and Part 2B §4.1:358's
// scorer (goal 40 · difficulty 20 · equipment 20 · duration 10) has nothing to
// read. The gender, level and workout-time sets are PORTED VERBATIM from the
// salvage source backend-auth/src/models/User.js:44-98 (R0.2). The goals and
// the equipment have since been changed by Kd (RULINGS 2026-09-10): one weight
// choice beside a list of goals, and "a gym" beside the home equipment. The
// numeric BOUNDS are not in that model and not in the spec: they are
// Kd-approved (DECISIONS 2026-07-15) sanity rails, not spec values.

export const genderSchema = z.enum(["male", "female", "other", "prefer_not_to_say"]);
export const fitnessLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);

/** Screen 1's ONE weight choice (RULINGS 2026-09-10): lose weight · keep my
 *  weight · gain weight. It alone sets the calories, and it is stored as the
 *  direction the plan maths works in, never derived from another goal:
 *  "maintain" is what the screens call "Keep my weight". */
export const weightGoalSchema = z.enum(["lose", "maintain", "gain"]);

/** Screen 1's "also work on", any number of them (RULINGS 2026-09-10). None of
 *  them moves the calories: building muscle is not gaining weight (RULINGS
 *  2026-09-11), and only its protein reads the list. Weight loss is not here,
 *  because it is a weight choice. `strength` (get stronger) and `balance`
 *  (better balance) are the two the goals ruling added, and `stay_healthy`
 *  the one Kd added at 4a-iv's click-through; the other six keep the old
 *  list's values, so no stored answer changes meaning. In the order the
 *  screens show them. */
export const fitnessGoalSchema = z.enum([
  "muscle_gain",
  "strength",
  "general_fitness",
  "endurance",
  "flexibility",
  "posture",
  "balance",
  "stress_relief",
  "stay_healthy",
]);
/** `gym` is "A gym", beside the home equipment (RULINGS 2026-09-10, decision
 *  B; the label 2026-09-11). */
export const equipmentSchema = z.enum([
  "none",
  "dumbbells",
  "resistance_bands",
  "kettlebells",
  "pull_up_bar",
  "gym",
]);
export const workoutTimeSchema = z.enum(["morning", "afternoon", "evening"]);

/** Screen 9's diet (RULINGS 2026-09-10), in the order that ruling names them.
 *  Every meal suggestion respects it — the meal ideas after a workout today
 *  (RULINGS 2026-09-13), the meal suggestions (7a) when they are built; nothing
 *  in the calorie maths reads it. It says what a person eats, never where the
 *  food is from — there is no cuisine question and no cuisine data (RULINGS
 *  2026-09-12).
 *
 *  The four are a ladder, and each value means exactly one more thing than the
 *  one below it: vegan eats no animal food at all, vegetarian adds milk,
 *  `vegetarian_eggs` adds eggs, and non-vegetarian adds meat and fish. Nothing
 *  is derived from another: a screen that showed "vegetarian" to a vegan would
 *  suggest them milk. */
export const dietSchema = z.enum(["vegetarian", "vegetarian_eggs", "non_vegetarian", "vegan"]);

/** How many meals a day the food is split across. Two is a real answer (people
 *  who skip one on purpose) and six is as many sittings as a day is ever
 *  planned in; the suggestions (7a) share the day's calories across this many.
 *  A rail, not a default — unanswered stays unanswered (RULINGS 2026-07-15). */
export const mealsPerDaySchema = z.number().int().min(2).max(6);

export type Gender = z.infer<typeof genderSchema>;
export type FitnessLevel = z.infer<typeof fitnessLevelSchema>;
export type WeightGoal = z.infer<typeof weightGoalSchema>;
export type FitnessGoal = z.infer<typeof fitnessGoalSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type WorkoutTime = z.infer<typeof workoutTimeSchema>;
export type Diet = z.infer<typeof dietSchema>;

/** A set, not a list: duplicates are rejected rather than silently deduped, so
 *  the parsed value is a true multiset-free set (R2.3 parse-don't-validate) —
 *  a repeated goal would otherwise double-weight Part 2B §4's scorer. */
const uniqueArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((a) => new Set(a).size === a.length, { message: "duplicate values are not allowed" });

/** THE goals rail, one object, used by both surfaces that write
 *  `fitness_goals` (Settings' PUT and screen 1's PATCH), for the reason the
 *  equipment rail below gives. Its cap is the number of goals there are. */
export const fitnessGoalsArraySchema = uniqueArray(fitnessGoalSchema, fitnessGoalSchema.options.length);

/** THE equipment rail, one object, used by every surface that writes
 *  `available_equipment` (Settings' PUT and screen 7's PATCH). Not a second
 *  call with the same arguments: two calls are two caps, and two caps can
 *  drift until the same answer is taken on one screen and refused on the other.
 *
 *  The cap IS the number of kinds there are, read from the enum rather than
 *  typed again, so adding a kind raises both surfaces in the same edit. With
 *  duplicates already refused it can never fire on its own; it stays as a
 *  bound on the size of the payload.
 *
 *  "No equipment" stands alone: "none and dumbbells" (or "none and a gym") is
 *  not an answer to "what do you have to train with?", and the plan builder
 *  (6a) would have to guess which half to believe. Both screens make it
 *  exclusive as you tap, and migration 0028 took "none" out of every pair the
 *  old form had stored, so ONE rail serves both surfaces. */
export const equipmentArraySchema = uniqueArray(equipmentSchema, equipmentSchema.options.length).refine(
  (a) => !a.includes("none") || a.length === 1,
  { message: "'none' cannot be combined with equipment" },
);

/** The stored profile. EVERY field is nullable: the wizard may be partial, and
 *  fitness_level is NULL until answered — unanswered is not 'beginner'
 *  (Kd-approved; the old Mongo model defaulted it, we deliberately do not).
 *  Weight is NOT here — it lives only in the weigh-in history (RULINGS
 *  2026-09-10) and is served on the profile as its newest entry.
 *  Lengths/units mirror the 0006 DDL: height/target weight are metric, the
 *  INVENTORY.md:45 XFORM convention. */
export const fitnessProfileSchema = z.object({
  age: z.number().int().nullable(),
  gender: genderSchema.nullable(),
  heightCm: z.number().nullable(),
  targetWeightKg: z.number().nullable(),
  fitnessLevel: fitnessLevelSchema.nullable(),
  /** Screen 1's "also work on". */
  fitnessGoals: z.array(fitnessGoalSchema),
  /** Screen 1's weight choice, the one answer that sets the calories: the side
   *  a target weight must be on is read from here. */
  weightGoal: weightGoalSchema.nullable(),
  exerciseFrequency: z.number().int().nullable(), // days per week
  availableEquipment: z.array(equipmentSchema),
  sessionDurationMin: z.number().int().nullable(), // minutes
  preferredWorkoutTime: workoutTimeSchema.nullable(),
  /** Screen 9's two answers (4b-ii), asked in Settings as well so they can be
   *  changed later. The meal ideas after a workout follow the diet; the meals
   *  a day wait for the meal suggestions (7a). */
  diet: dietSchema.nullable(),
  mealsPerDay: z.number().int().nullable(),
  onboardingCompleted: z.boolean(),
  /** NULL for a user who has never saved onboarding (no row): the GET returns
   *  the empty profile rather than a 404, so the wizard renders blank instead of
   *  branching on an error, and a synthesized timestamp would be a lie. */
  updatedAt: z.string().nullable(), // ISO timestamptz
});
export type FitnessProfile = z.infer<typeof fitnessProfileSchema>;

export const fitnessProfileResponseSchema = z.object({ fitnessProfile: fitnessProfileSchema });
export type FitnessProfileResponse = z.infer<typeof fitnessProfileResponseSchema>;

/** PUT body — FULL-DOCUMENT replace (the wizard submits the whole profile):
 *  an omitted field is written as NULL, which is what PUT means. That also makes
 *  the write idempotent (R3.5): the same body twice yields the same row.
 *  Bounds are the Kd-approved rails; heightCm/targetWeightKg additionally mirror
 *  numeric(5,2) (2dp, < 1000) exactly as updateProfileRequestSchema does for
 *  weightKg. onboardingCompleted defaults false so a partial save cannot
 *  accidentally satisfy the gate.
 *
 *  `medicalConditions` is GONE (4b-i): the free-text notes box was switched off
 *  and its column dropped with everything ever typed in it (RULINGS 2026-09-09).
 *  The app's one health question is the screening in health.ts, which stores a
 *  yes or no and nothing else; being `.strict()`, this body now refuses the old
 *  field rather than quietly dropping it. */
export const putFitnessProfileRequestSchema = z
  .object({
    age: z.number().int().min(16).max(120).nullable().optional(), // the app is for 16 and over (RULINGS 2026-09-07)
    gender: genderSchema.nullable().optional(),
    heightCm: z.number().min(50).max(300).multipleOf(0.01).nullable().optional(),
    targetWeightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
    fitnessLevel: fitnessLevelSchema.nullable().optional(),
    fitnessGoals: fitnessGoalsArraySchema.optional(),
    weightGoal: weightGoalSchema.nullable().optional(),
    exerciseFrequency: z.number().int().min(1).max(7).nullable().optional(),
    availableEquipment: equipmentArraySchema.optional(),
    sessionDurationMin: z.number().int().min(5).max(240).nullable().optional(),
    preferredWorkoutTime: workoutTimeSchema.nullable().optional(),
    diet: dietSchema.nullable().optional(),
    mealsPerDay: mealsPerDaySchema.nullable().optional(),
    onboardingCompleted: z.boolean().optional(),
  })
  .strict();
export type PutFitnessProfileRequest = z.infer<typeof putFitnessProfileRequestSchema>;
