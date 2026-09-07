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

/** PATCH body: preference/display fields ONLY — server-owned fields (email,
 *  status, plan-adjacent anything) are not writable here (R3.1). Locale/units
 *  value sets recorded in DECISIONS (P2.2): locales = the spec's EN/HI/AS
 *  (Part 2 Appendix A localization triad); units = metric|imperial.
 *  weightKg bounds mirror numeric(5,2) (Part 4 §3.1). */
export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
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
// read. Every value set below is PORTED VERBATIM from the salvage source
// backend-auth/src/models/User.js:44-98 — none re-derived (R0.2). The numeric
// BOUNDS are not in that model and not in the spec: they are Kd-approved
// (DECISIONS 2026-07-15) sanity rails, not spec values.

export const genderSchema = z.enum(["male", "female", "other", "prefer_not_to_say"]);
export const fitnessLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const fitnessGoalSchema = z.enum([
  "weight_loss",
  "muscle_gain",
  "general_fitness",
  "flexibility",
  "endurance",
  "posture",
  "stress_relief",
]);
export const equipmentSchema = z.enum([
  "none",
  "dumbbells",
  "resistance_bands",
  "kettlebells",
  "pull_up_bar",
]);
export const workoutTimeSchema = z.enum(["morning", "afternoon", "evening"]);

export type Gender = z.infer<typeof genderSchema>;
export type FitnessLevel = z.infer<typeof fitnessLevelSchema>;
export type FitnessGoal = z.infer<typeof fitnessGoalSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type WorkoutTime = z.infer<typeof workoutTimeSchema>;

/** A set, not a list: duplicates are rejected rather than silently deduped, so
 *  the parsed value is a true multiset-free set (R2.3 parse-don't-validate) —
 *  a repeated goal would otherwise double-weight Part 2B §4's scorer. */
const uniqueArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine((a) => new Set(a).size === a.length, { message: "duplicate values are not allowed" });

/** The stored profile. EVERY field is nullable: the wizard may be partial, and
 *  fitness_level is NULL until answered — unanswered is not 'beginner'
 *  (Kd-approved; the old Mongo model defaulted it, we deliberately do not).
 *  Weight is NOT here — it lives on users.weight_kg (Part 4 §3.1), unduplicated.
 *  Lengths/units mirror the 0006 DDL: height/target weight are metric, matching
 *  users.weight_kg and the INVENTORY.md:45 XFORM convention. */
export const fitnessProfileSchema = z.object({
  age: z.number().int().nullable(),
  gender: genderSchema.nullable(),
  heightCm: z.number().nullable(),
  targetWeightKg: z.number().nullable(),
  fitnessLevel: fitnessLevelSchema.nullable(),
  fitnessGoals: z.array(fitnessGoalSchema),
  exerciseFrequency: z.number().int().nullable(), // days per week
  availableEquipment: z.array(equipmentSchema),
  sessionDurationMin: z.number().int().nullable(), // minutes
  preferredWorkoutTime: workoutTimeSchema.nullable(),
  medicalConditions: z.string().nullable(),
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
 *  accidentally satisfy the gate. */
export const putFitnessProfileRequestSchema = z
  .object({
    age: z.number().int().min(13).max(120).nullable().optional(),
    gender: genderSchema.nullable().optional(),
    heightCm: z.number().min(50).max(300).multipleOf(0.01).nullable().optional(),
    targetWeightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
    fitnessLevel: fitnessLevelSchema.nullable().optional(),
    fitnessGoals: uniqueArray(fitnessGoalSchema, 7).optional(),
    exerciseFrequency: z.number().int().min(1).max(7).nullable().optional(),
    availableEquipment: uniqueArray(equipmentSchema, 5).optional(),
    sessionDurationMin: z.number().int().min(5).max(240).nullable().optional(),
    preferredWorkoutTime: workoutTimeSchema.nullable().optional(),
    medicalConditions: z.string().trim().max(2000).nullable().optional(),
    onboardingCompleted: z.boolean().optional(),
  })
  .strict();
export type PutFitnessProfileRequest = z.infer<typeof putFitnessProfileRequestSchema>;
