// P2.1 — auth service: the audited backend-auth semantics (R3.7), re-expressed
// on Postgres-backed rotating refresh tokens (v1 §6.1, Part 4 §3.1):
//   · bcrypt cost 10 (GAP-1 DECISIONS 2026-07-11: bcrypt-only this task)
//   · timing-equalizer dummy-hash on unknown emails (authController.js:16-18)
//   · "Invalid email or password" NEVER distinguishes no-user / wrong-password
//   · one-time tokens stored as SHA-256 only
//   · refresh reuse kills the whole family
import bcrypt from "bcryptjs";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import type { AppConfig } from "../../config.js";
import type { EmailSender } from "./email.js";
import * as repo from "./repo.js";
import { mintOpaqueToken, newFamilyId, sha256Hex, signAccessToken } from "./tokens.js";
import type { AuthUser } from "./schemas.js";

export const BCRYPT_COST = 10; // R3.7: "bcrypt (cost ≥ 10)"

/** Injectable so the timing-equalizer path is unit-testable with a spy
 *  (a wall-clock timing assertion would be flaky — plan §4). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

export const bcryptHasher: PasswordHasher = {
  hash: (password) => bcrypt.hash(password, BCRYPT_COST),
  compare: (password, hash) => bcrypt.compare(password, hash),
};

// Pre-computed hash equalizing login timing when the email doesn't exist —
// ported verbatim in spirit from authController.js:14-18 (deliberate fix:
// without it "no such account" returns ~100ms faster than "wrong password",
// letting attackers enumerate registered emails).
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", BCRYPT_COST);

// One-time token lifetimes, ported from authController.js:74 (24 h
// verification) and :211 (1 h reset).
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/** Typed auth failure: `code`+`statusCode` feed the central error mapper
 *  (R8.1); message is already client-safe. */
export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// The uniform credentials failure (R3.7: never distinguish which part failed).
const invalidCredentials = () => new AuthError(401, "invalid_credentials", "Invalid email or password");

export interface AuthDeps {
  sql: Sql;
  config: AppConfig;
  emailSender: EmailSender;
  hasher: PasswordHasher;
  log: FastifyBaseLogger;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string; // raw opaque — cookie-bound by the route, never stored raw
}

async function issueSession(
  deps: AuthDeps,
  userId: string,
  meta: RequestMeta,
  familyId = newFamilyId(),
): Promise<SessionTokens> {
  const refreshToken = mintOpaqueToken();
  const expiresAt = new Date(Date.now() + deps.config.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await repo.insertRefreshToken(deps.sql, {
    userId,
    familyId,
    tokenHash: sha256Hex(refreshToken),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { accessToken: signAccessToken(userId, deps.config), refreshToken };
}

async function toAuthUser(sql: Sql, row: repo.UserAuthRow): Promise<AuthUser> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: await repo.isEmailVerified(sql, row.id),
    locale: row.locale,
    units: row.units,
  };
}

// ── register ────────────────────────────────────────────────────────────────

export async function register(
  deps: AuthDeps,
  input: { email: string; password: string; displayName: string },
): Promise<{ userId: string }> {
  const passwordHash = await deps.hasher.hash(input.password);
  const userId = await repo.createUser(deps.sql, {
    email: input.email,
    passwordHash,
    displayName: input.displayName,
  });
  if (userId === null) {
    // Ported semantics (authController.js:65-70): register reveals duplicates.
    throw new AuthError(400, "email_taken", "An account with this email already exists");
  }
  const rawToken = mintOpaqueToken();
  await repo.createOneTimeToken(deps.sql, {
    userId,
    purpose: "verify_email",
    tokenHash: sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });
  // Don't fail registration if email fails — ported (authController.js:84-90).
  try {
    await deps.emailSender.sendVerificationEmail(input.email, input.displayName, rawToken);
  } catch (err) {
    // R2.5/R3.10: logged with event name + userId only — never token/address.
    deps.log.warn({ err, event: "email.verification.send_failed", userId }, "email send failed");
  }
  return { userId };
}

// ── login ───────────────────────────────────────────────────────────────────

export async function login(
  deps: AuthDeps,
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<{ user: AuthUser; tokens: SessionTokens }> {
  const user = await repo.findUserByEmail(deps.sql, input.email);
  if (user === null || user.passwordHash === null || user.status !== "active") {
    // Timing equalizer: run a compare anyway so "no such account" (and
    // OAuth-only / deleted accounts) takes as long as "wrong password".
    await deps.hasher.compare(input.password, DUMMY_HASH);
    throw invalidCredentials();
  }
  const ok = await deps.hasher.compare(input.password, user.passwordHash);
  if (!ok) throw invalidCredentials();
  return { user: await toAuthUser(deps.sql, user), tokens: await issueSession(deps, user.id, meta) };
}

// ── refresh (rotation + reuse detection) ────────────────────────────────────

export async function refresh(
  deps: AuthDeps,
  rawRefreshToken: string,
  meta: RequestMeta,
): Promise<SessionTokens> {
  const row = await repo.findRefreshTokenByHash(deps.sql, sha256Hex(rawRefreshToken));
  if (row === null) throw new AuthError(401, "invalid_refresh", "Invalid refresh token");
  if (row.revokedAt !== null) {
    // Reuse of a rotated-out/revoked member: the family is compromised —
    // kill it all (Part 4 §3.1).
    await repo.revokeFamily(deps.sql, row.userId, row.familyId);
    throw new AuthError(401, "invalid_refresh", "Invalid refresh token");
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AuthError(401, "invalid_refresh", "Invalid refresh token");
  }
  const user = await repo.findUserById(deps.sql, row.userId);
  if (user === null || user.status !== "active") {
    throw new AuthError(401, "invalid_refresh", "Invalid refresh token");
  }
  const refreshToken = mintOpaqueToken();
  try {
    await repo.rotateRefreshToken(deps.sql, {
      oldId: row.id,
      userId: row.userId,
      familyId: row.familyId,
      newTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + deps.config.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  } catch (err) {
    if (err instanceof repo.RefreshRotationRaceError) {
      // A concurrent presentation of the same token beat us: that IS reuse —
      // kill the family, including the winner's freshly minted successor
      // (T3 2026-07-11; Part 4 §3.1 "reuse kills the family").
      await repo.revokeFamily(deps.sql, row.userId, row.familyId);
      throw new AuthError(401, "invalid_refresh", "Invalid refresh token");
    }
    throw err;
  }
  return { accessToken: signAccessToken(row.userId, deps.config), refreshToken };
}

// ── logout ──────────────────────────────────────────────────────────────────

/** Revokes the presented token's whole family (the login session). Unknown
 *  token → still succeeds: logout must be idempotent and never an oracle. */
export async function logout(deps: AuthDeps, rawRefreshToken: string | null): Promise<void> {
  if (rawRefreshToken === null) return;
  const row = await repo.findRefreshTokenByHash(deps.sql, sha256Hex(rawRefreshToken));
  if (row !== null) await repo.revokeFamily(deps.sql, row.userId, row.familyId);
}

// ── email verification ──────────────────────────────────────────────────────

/** Ported: successful verification logs the user in (authController.js:129). */
export async function verifyEmail(
  deps: AuthDeps,
  rawToken: string,
  meta: RequestMeta,
): Promise<{ user: AuthUser; tokens: SessionTokens }> {
  const userId = await repo.consumeOneTimeToken(deps.sql, "verify_email", sha256Hex(rawToken));
  if (userId === null) {
    throw new AuthError(400, "invalid_token", "Invalid or expired verification token");
  }
  const user = await repo.findUserById(deps.sql, userId);
  if (user === null || user.status !== "active") {
    throw new AuthError(400, "invalid_token", "Invalid or expired verification token");
  }
  return { user: await toAuthUser(deps.sql, user), tokens: await issueSession(deps, userId, meta) };
}

// ── forgot / reset password ─────────────────────────────────────────────────

/** ALWAYS resolves to the same outcome — existence is never revealed
 *  (authController.js:200-204). The route sends one fixed 200 body. */
export async function forgotPassword(deps: AuthDeps, email: string): Promise<void> {
  const user = await repo.findUserByEmail(deps.sql, email);
  if (user === null || user.status !== "active") return;
  const rawToken = mintOpaqueToken();
  await repo.createOneTimeToken(deps.sql, {
    userId: user.id,
    purpose: "password_reset",
    tokenHash: sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  try {
    await deps.emailSender.sendPasswordResetEmail(email, user.displayName, rawToken);
  } catch (err) {
    // Sender failure must not change the uniform response (no oracle) — but
    // it is logged (R2.5), with event name + userId only (R3.10).
    deps.log.warn({ err, event: "email.password_reset.send_failed", userId: user.id }, "email send failed");
  }
}

export async function resetPassword(
  deps: AuthDeps,
  input: { token: string; password: string },
): Promise<void> {
  const userId = await repo.consumeOneTimeToken(deps.sql, "password_reset", sha256Hex(input.token));
  if (userId === null) {
    throw new AuthError(400, "invalid_token", "Invalid or expired reset token");
  }
  await repo.setPasswordHash(deps.sql, userId, await deps.hasher.hash(input.password));
  // A reset means the credential may have been compromised: log out everywhere.
  await repo.revokeAllRefreshTokens(deps.sql, userId);
}

// ── change password (authenticated) ─────────────────────────────────────────

export async function changePassword(
  deps: AuthDeps,
  userId: string,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta,
): Promise<SessionTokens> {
  const user = await repo.findUserById(deps.sql, userId);
  if (user === null || user.status !== "active") throw invalidCredentials();
  if (user.passwordHash === null) {
    // Ported (authController.js:309-314): OAuth-only accounts have no password.
    throw new AuthError(400, "no_password", "Password change not available for this account");
  }
  const ok = await deps.hasher.compare(input.currentPassword, user.passwordHash);
  if (!ok) throw new AuthError(401, "invalid_credentials", "Current password is incorrect");
  await repo.setPasswordHash(deps.sql, userId, await deps.hasher.hash(input.newPassword));
  // Revoke every session, then hand the caller a fresh one.
  await repo.revokeAllRefreshTokens(deps.sql, userId);
  return await issueSession(deps, userId, meta);
}

// ── narrow service-interface exports for the users module (P2.2, R7.1) ──────
// Cross-module calls go through these — never through this module's repo or
// tables. one_time_tokens / refresh_tokens stay auth-owned.

/** Part 4 §5.2: the undo window is 14 days — the token lives exactly that long. */
const RESTORE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function isUserEmailVerified(sql: Sql, userId: string): Promise<boolean> {
  return await repo.isEmailVerified(sql, userId);
}

/** Mints + stores (hashed) a restore_account token; returns the raw token for
 *  the undo email. Supersedes any previous unused restore token (repo semantics). */
export async function issueRestoreToken(sql: Sql, userId: string): Promise<string> {
  const rawToken = mintOpaqueToken();
  await repo.createOneTimeToken(sql, {
    userId,
    purpose: "restore_account",
    tokenHash: sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + RESTORE_TTL_MS),
  });
  return rawToken;
}

/** Atomic single-use consume; null = unknown/used/expired (uniformly). */
export async function consumeRestoreToken(sql: Sql, rawToken: string): Promise<string | null> {
  return await repo.consumeOneTimeToken(sql, "restore_account", sha256Hex(rawToken));
}

/** "Log out everywhere" — Part 4 §5.2 Day 0: all refresh tokens revoked. */
export async function revokeAllSessions(sql: Sql, userId: string): Promise<void> {
  await repo.revokeAllRefreshTokens(sql, userId);
}

// ── me ──────────────────────────────────────────────────────────────────────

export async function getMe(deps: AuthDeps, userId: string): Promise<AuthUser> {
  const user = await repo.findUserById(deps.sql, userId);
  if (user === null || user.status !== "active") {
    throw new AuthError(401, "unauthorized", "authentication required");
  }
  return await toAuthUser(deps.sql, user);
}
