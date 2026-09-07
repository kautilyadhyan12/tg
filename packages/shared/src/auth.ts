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

// ── sign-in by 6-digit email code (Kd ruling 2026-09-07, amended the same day:
// one resend per code, at most two codes a day per address) ─────────────────

/** The rules the SERVER enforces and the SCREEN describes — one home, so the
 *  countdown a person watches and the refusal they get can never disagree. */
export const SIGN_IN_CODE_RULES = {
  /** A code is good for ten minutes. */
  ttlSeconds: 600,
  /** A resend is offered after sixty seconds. */
  resendAfterSeconds: 60,
  /** Two codes per address per rolling day — the first and its one resend. */
  maxCodesPerDay: 2,
  /** Five wrong guesses kill the code. */
  maxAttempts: 5,
} as const;

export const signInCodeSchema = z.string().regex(/^\d{6}$/, "six digits");

export const sendCodeRequestSchema = z.object({ email: authEmailSchema }).strict();
export type SendCodeRequest = z.infer<typeof sendCodeRequestSchema>;

export const sendCodeResponseSchema = z.object({
  message: z.string(),
  resendAfterSeconds: z.number().int().nonnegative(),
  expiresInSeconds: z.number().int().positive(),
});
export type SendCodeResponse = z.infer<typeof sendCodeResponseSchema>;

export const verifyCodeRequestSchema = z
  .object({ email: authEmailSchema, code: signInCodeSchema })
  .strict();
export type VerifyCodeRequest = z.infer<typeof verifyCodeRequestSchema>;

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

/** A verified code signs you in AND creates the account if the address is new
 *  — the Get started screen greets a new account differently ("your account
 *  is ready") from a returning one, and nothing else reads it. */
export const verifyCodeResponseSchema = z.object({
  user: authUserSchema,
  isNewAccount: z.boolean(),
});
export type VerifyCodeResponse = z.infer<typeof verifyCodeResponseSchema>;

export const registerResponseSchema = z.object({
  userId: z.string().uuid(),
  message: z.string(),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
