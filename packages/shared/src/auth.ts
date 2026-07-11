// P2.1 — auth request/response contracts (R7.2: every shape lives once, here).
// Semantics ported from the audited backend-auth validators: email ≤254,
// password 8–128, one-time tokens ≤128 (authController.js:107,193,234,238).
// All request bodies are .strict() so unknown keys are rejected (Part IV #5).
import { z } from "zod";

/** citext in the DB handles case; trim + lowercase here so rate-limit
 *  identifier keys and lookups agree on one canonical form. */
export const authEmailSchema = z.string().trim().toLowerCase().max(254).email();

export const authPasswordSchema = z.string().min(8).max(128);

/** Raw one-time / opaque tokens are 32 random bytes hex-encoded (64 chars);
 *  the ≤128 ceiling is the audited validator's, kept as a hard cap. */
export const oneTimeTokenSchema = z.string().min(1).max(128);

export const registerRequestSchema = z
  .object({
    email: authEmailSchema,
    password: authPasswordSchema,
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({ email: authEmailSchema, password: z.string().min(1).max(128) })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyEmailRequestSchema = z.object({ token: oneTimeTokenSchema }).strict();
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: authEmailSchema }).strict();
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z
  .object({ token: oneTimeTokenSchema, password: authPasswordSchema })
  .strict();
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: authPasswordSchema,
  })
  .strict();
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Minimal authenticated-user view (full profile is the users module, P2.2).
 *  No tokens anywhere in a body — cookies only (DECISIONS 2026-07-11). */
export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  locale: z.string(),
  units: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionResponseSchema = z.object({ user: authUserSchema });
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const registerResponseSchema = z.object({
  userId: z.string().uuid(),
  message: z.string(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
