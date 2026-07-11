// P2.2 — users/profile contracts (R7.2: every shape lives once, here).
// Full profile view (v1 §6.1 users module); the minimal auth view stays in
// auth.ts. All request bodies are .strict() (Part IV #5).
import { z } from "zod";
import { oneTimeTokenSchema } from "./auth.js";

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
