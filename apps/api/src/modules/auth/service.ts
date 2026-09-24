// P2.1 — auth service: the audited backend-auth semantics (R3.7), re-expressed
// on Postgres-backed rotating refresh tokens (v1 §6.1, Part 4 §3.1):
//   · bcrypt cost 10 (GAP-1 DECISIONS 2026-07-11: bcrypt-only this task)
//   · timing-equalizer dummy-hash on unknown emails (authController.js:16-18)
//   · "Invalid email or password" NEVER distinguishes no-user / wrong-password
//   · one-time tokens stored as SHA-256 only
//   · refresh reuse kills the whole family
import bcrypt from "bcryptjs";
import { hash as argon2Hash, hashSync as argon2HashSync, verify as argon2Verify } from "@node-rs/argon2";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import type { AppConfig } from "../../config.js";
import { DPDP_RETENTION_MS } from "../../retention.js";
import * as codes from "./codes.js";
import type { CodePurpose, CodeSender } from "./codes.js";
import type { EmailSender } from "./email.js";
import { AuthError } from "./errors.js";
import * as repo from "./repo.js";
import type { HashAlgo } from "./repo.js";
import { mintOpaqueToken, newFamilyId, sha256Hex, signAccessToken } from "./tokens.js";
import type { AuthUser } from "./schemas.js";

export { AuthError } from "./errors.js";

// argon2id parameters — OWASP minimum (memory 19456 KiB, iterations 2,
// parallelism 1). `algorithm: 2` is Algorithm.Argon2id; the library exports it
// as a `const enum`, which cannot be imported as a value under isolatedModules
// (R2.1/TS2748), so the numeric member value is passed directly — the
// '$argon2id$' output format is asserted in the unit tests. Version defaults to
// v19 (0x13). `as const` keeps `algorithm` a literal `2` (a widened `number`
// would not satisfy the Algorithm parameter type).
const ARGON2ID_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

/** Verifies bcrypt (legacy) AND argon2id hashes, produces argon2id, and signals
 *  the rehash-on-login upgrade (v1 §6.1). Injectable so the timing-equalizer
 *  path is unit-testable with a spy (a wall-clock assertion would be flaky). */
export interface PasswordHasher {
  /** The algorithm this hasher PRODUCES; written to users.hash_algo on create/rehash. */
  readonly algo: HashAlgo;
  hash(password: string): Promise<string>;
  /** Verify against a hash produced by EITHER algorithm, dispatched on the stored algo. */
  verify(password: string, hash: string, algo: HashAlgo): Promise<boolean>;
  /** True when a stored hash should be upgraded to `this.algo` on next login. */
  needsRehash(algo: HashAlgo | null): boolean;
}

export const argon2idHasher: PasswordHasher = {
  algo: "argon2id",
  hash: (password) => argon2Hash(password, ARGON2ID_OPTS),
  verify: (password, hash, algo) => {
    switch (algo) {
      // NB argon2Verify(hashed, password) — the hash is the FIRST argument,
      // opposite to bcrypt.compare(password, hash) (Part IV trap class).
      case "argon2id":
        return argon2Verify(hash, password);
      case "bcrypt":
        return bcrypt.compare(password, hash);
      default: {
        const _exhaustive: never = algo; // R2.4: exhaustive over HashAlgo
        return _exhaustive;
      }
    }
  },
  needsRehash: (algo) => algo !== "argon2id",
};

// Pre-computed argon2id hash equalizing login timing when the email doesn't
// exist — ported in spirit from authController.js:14-18 (deliberate fix:
// without it "no such account" returns faster than "wrong password", letting
// attackers enumerate registered emails). Exported so a unit test can assert it
// is argon2id. NOTE (DECISIONS): one dummy cannot equalize timing across a mixed
// bcrypt+argon2id population — a not-yet-upgraded bcrypt user's login times
// differently from an unknown-email attempt until they rehash. Self-healing.
export const DUMMY_HASH = argon2HashSync("timing-equalizer-not-a-real-password", ARGON2ID_OPTS);

// One-time token lifetimes, ported from authController.js:74 (24 h
// verification) and :211 (1 h reset).
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

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

const refreshExpiry = (deps: AuthDeps): Date => new Date(Date.now() + deps.config.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

async function issueSession(
  deps: AuthDeps,
  userId: string,
  meta: RequestMeta,
  familyId = newFamilyId(),
): Promise<SessionTokens> {
  const refreshToken = mintOpaqueToken();
  const expiresAt = refreshExpiry(deps);
  await repo.insertRefreshToken(deps.sql, {
    userId,
    familyId,
    tokenHash: sha256Hex(refreshToken),
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { accessToken: signAccessToken(userId, deps.config, familyId), refreshToken };
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
    algo: deps.hasher.algo,
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
  if (user === null || user.passwordHash === null || user.hashAlgo === null || user.status !== "active") {
    // Timing equalizer: run a verify anyway so "no such account" (and
    // OAuth-only / deleted / algo-less accounts) takes as long as "wrong
    // password". The dummy is argon2id, so verify against this hasher's algo.
    await deps.hasher.verify(input.password, DUMMY_HASH, deps.hasher.algo);
    throw invalidCredentials();
  }
  const ok = await deps.hasher.verify(input.password, user.passwordHash, user.hashAlgo);
  if (!ok) throw invalidCredentials();
  const checked = [user.passwordHash];
  // Transparent upgrade to argon2id (v1 §6.1). BEST-EFFORT: a rehash write
  // failure must NEVER fail an already-valid login — swallowed + logged, same
  // pattern as the email sends above (R2.5 exception, deliberate). Awaited so
  // the upgrade is durable before the session is returned (and observable).
  if (deps.hasher.needsRehash(user.hashAlgo)) {
    try {
      const rehashed = await deps.hasher.hash(input.password);
      const upgraded = await repo.replacePasswordHash(deps.sql, {
        userId: user.id,
        checkedHash: user.passwordHash,
        newHash: rehashed,
        algo: deps.hasher.algo,
      });
      if (upgraded) checked.push(rehashed);
    } catch (err) {
      deps.log.warn(
        { err, event: "auth.password_rehash_failed", userId: user.id },
        "password rehash on login failed",
      );
    }
  }
  // The session is written only if the password checked is still the account's: the
  // address's first proof may have ended it while it was being checked.
  const familyId = newFamilyId();
  const refreshToken = mintOpaqueToken();
  const started = await repo.insertRefreshTokenForPassword(deps.sql, {
    userId: user.id,
    checkedHashes: checked,
    familyId,
    tokenHash: sha256Hex(refreshToken),
    expiresAt: refreshExpiry(deps),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  if (!started) throw invalidCredentials();
  return {
    user: await toAuthUser(deps.sql, user),
    tokens: { accessToken: signAccessToken(user.id, deps.config, familyId), refreshToken },
  };
}

// ── Google sign-in (google-login card; v1 §6.1) ─────────────────────────────

/** A live account that can't accept a Google sign-in (soft-deleted, etc.).
 *  Never distinguishes why (R3.7 spirit) — the route redirects generically. */
const googleUnavailable = () =>
  new AuthError(403, "google_unavailable", "This account is not available for Google sign-in");

/** Ported fallback (passport.js:55): Google display name, else "New User".
 *  display_name is NOT NULL (identity.ts:25). Bounded defensively. */
function oauthDisplayName(name: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 100) : "New User";
}

/** Record email-verified once (idempotent — skips if a verify_email marker
 *  already exists), using the derivation isEmailVerified() already reads
 *  (DECISIONS: no verified column). Google asserts the address; a proved
 *  sign-in code proves it. The first proof also ends any password and session
 *  set up before it (repo). Runs before the new session is issued. */
async function ensureEmailVerified(deps: AuthDeps, userId: string): Promise<void> {
  await repo.recordVerifiedEmail(deps.sql, userId, sha256Hex(mintOpaqueToken()));
}

/** Google sign-in: log in the linked identity, else link Google to an existing
 *  same-email account (password untouched — passport.js:41-43), else create an
 *  OAuth-only user. Returns a session exactly like password login. */
export async function googleSignIn(
  deps: AuthDeps,
  identity: { subject: string; email: string; name: string | null },
  meta: RequestMeta,
): Promise<{ user: AuthUser; tokens: SessionTokens }> {
  // 1. Known Google identity → straight login.
  const linkedUserId = await repo.findUserIdByAuthIdentity(deps.sql, "google", identity.subject);
  if (linkedUserId !== null) {
    const user = await repo.findUserById(deps.sql, linkedUserId);
    if (user === null || user.status !== "active") throw googleUnavailable();
    return { user: await toAuthUser(deps.sql, user), tokens: await issueSession(deps, user.id, meta) };
  }

  // 2. Existing account with this email → link Google to it, then log in. A
  //    password stays only if the address was proved before it; one set on an
  //    address nobody had proved ends here (ensureEmailVerified).
  const byEmail = await repo.findUserByEmail(deps.sql, identity.email);
  if (byEmail !== null) {
    if (byEmail.status !== "active") throw googleUnavailable();
    await repo.linkAuthIdentity(deps.sql, { userId: byEmail.id, provider: "google", subject: identity.subject });
    await ensureEmailVerified(deps, byEmail.id);
    return { user: await toAuthUser(deps.sql, byEmail), tokens: await issueSession(deps, byEmail.id, meta) };
  }

  // 3. Brand-new OAuth-only user from the Google profile.
  const newUserId = await repo.createPasswordlessUser(deps.sql, {
    email: identity.email,
    displayName: oauthDisplayName(identity.name),
  });
  if (newUserId === null) {
    // Lost a concurrent create race on the email → re-resolve and link.
    const raced = await repo.findUserByEmail(deps.sql, identity.email);
    if (raced === null || raced.status !== "active") throw googleUnavailable();
    await repo.linkAuthIdentity(deps.sql, { userId: raced.id, provider: "google", subject: identity.subject });
    await ensureEmailVerified(deps, raced.id);
    return { user: await toAuthUser(deps.sql, raced), tokens: await issueSession(deps, raced.id, meta) };
  }
  await repo.linkAuthIdentity(deps.sql, { userId: newUserId, provider: "google", subject: identity.subject });
  await ensureEmailVerified(deps, newUserId);
  const created = await repo.findUserById(deps.sql, newUserId);
  if (created === null) throw new Error("created Google user could not be re-read");
  return { user: await toAuthUser(deps.sql, created), tokens: await issueSession(deps, newUserId, meta) };
}

// ── sign-in by email code (Kd 2026-09-07) ───────────────────────────────────

/** The starting display name for an account made by proving an email: the
 *  part before the @, the person's own data rather than an invented one
 *  (RULINGS: no invented defaults). Onboarding v2's "about you" screen is
 *  where they set the real one. Bounded like the OAuth fallback. Exported for the
 *  roster's "Check this is them", where such a name is no evidence of who it is. */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  return local.length > 0 ? local.slice(0, 100) : "New User";
}

const codeDeps = (deps: AuthDeps): codes.CodeDeps => ({ sql: deps.sql, config: deps.config, log: deps.log });

/** Ask for a sign-in code. Same answer whether or not the address has an
 *  account, and no account is created here. */
export async function requestSignInCode(
  deps: AuthDeps,
  email: string,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
  return await codes.requestCode(codeDeps(deps), { email, purpose: "sign_in" }, (to, code) =>
    deps.emailSender.sendSignInCodeEmail(to, code),
  );
}

/** A proved code signs the address in — and creates the account first if the
 *  address is new. Returns a session exactly like password or Google login. */
export async function signInWithCode(
  deps: AuthDeps,
  input: { email: string; code: string },
  meta: RequestMeta,
): Promise<{ user: AuthUser; tokens: SessionTokens; isNewAccount: boolean }> {
  await codes.redeemCode(codeDeps(deps), { email: input.email, purpose: "sign_in", code: input.code });

  let user = await repo.findUserByEmail(deps.sql, input.email);
  let isNewAccount = false;
  if (user === null) {
    const newUserId = await repo.createPasswordlessUser(deps.sql, {
      email: input.email,
      displayName: displayNameFromEmail(input.email),
    });
    if (newUserId === null) {
      // Lost a concurrent create race on the email → the other one is ours.
      user = await repo.findUserByEmail(deps.sql, input.email);
    } else {
      user = await repo.findUserById(deps.sql, newUserId);
      isNewAccount = true;
    }
  }
  if (user === null) throw new Error("code sign-in user could not be re-read");
  if (user.status !== "active") {
    // The person has just PROVED they hold the address, so telling them their
    // own account is mid-deletion reveals nothing to a stranger.
    throw new AuthError(
      403,
      "account_unavailable",
      "This account is being deleted. Use the link in the email we sent you to restore it, then try again.",
    );
  }
  await ensureEmailVerified(deps, user.id);
  return {
    user: await toAuthUser(deps.sql, user),
    tokens: await issueSession(deps, user.id, meta),
    isNewAccount,
  };
}

// ── narrow code exports for the users module (R7.1) ─────────────────────────
// Deleting an account is confirmed with a code of its own purpose. The users
// module reaches the mechanism through these and never through the repo.

export async function requestEmailCode(
  deps: { sql: Sql; config: AppConfig; log: FastifyBaseLogger },
  input: { email: string; purpose: CodePurpose },
  send: CodeSender,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
  return await codes.requestCode(deps, input, send);
}

export async function redeemEmailCode(
  deps: { sql: Sql; config: AppConfig; log: FastifyBaseLogger },
  input: { email: string; purpose: CodePurpose; code: string },
): Promise<void> {
  await codes.redeemCode(deps, input);
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
  return { accessToken: signAccessToken(row.userId, deps.config, row.familyId), refreshToken };
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
  const userId = await repo.consumeVerifyEmailToken(deps.sql, sha256Hex(rawToken));
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
  await repo.setPasswordHash(deps.sql, userId, await deps.hasher.hash(input.password), deps.hasher.algo);
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
  if (user.passwordHash === null || user.hashAlgo === null) {
    // Ported (authController.js:309-314): OAuth-only accounts have no password.
    throw new AuthError(400, "no_password", "Password change not available for this account");
  }
  const ok = await deps.hasher.verify(input.currentPassword, user.passwordHash, user.hashAlgo);
  if (!ok) throw new AuthError(401, "invalid_credentials", "Current password is incorrect");
  // Revoke every session, then hand the caller a fresh one — only if the password
  // checked is still the account's (the address's first proof may have ended it).
  const familyId = newFamilyId();
  const refreshToken = mintOpaqueToken();
  const changed = await repo.changePasswordIfUnchanged(deps.sql, {
    userId,
    checkedHash: user.passwordHash,
    newHash: await deps.hasher.hash(input.newPassword),
    algo: deps.hasher.algo,
    familyId,
    tokenHash: sha256Hex(refreshToken),
    expiresAt: refreshExpiry(deps),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  if (!changed) throw new AuthError(401, "invalid_credentials", "Current password is incorrect");
  return { accessToken: signAccessToken(userId, deps.config, familyId), refreshToken };
}

// ── narrow service-interface exports for the users module (P2.2, R7.1) ──────
// Cross-module calls go through these — never through this module's repo or
// tables. one_time_tokens / refresh_tokens stay auth-owned.

/** Part 4 §5.2: the token lives exactly as long as the undo window, so it is
 *  read from src/retention.ts rather than restated here — see that file for
 *  why the number has exactly one home. */
const RESTORE_TTL_MS = DPDP_RETENTION_MS;

export async function isUserEmailVerified(sql: Sql, userId: string): Promise<boolean> {
  return await repo.isEmailVerified(sql, userId);
}

/** The active account's address, and whether THIS sign-in session may answer for it:
 *  the address is proved, and the session is still live and began after the first
 *  proof (Part 3 §10.2; see `recordVerifiedEmail`). Null when there is no such account
 *  or it has no address. */
export async function accountAddress(
  sql: Sql,
  userId: string,
  familyId: string | null,
): Promise<{ email: string; provedForSession: boolean } | null> {
  const user = await repo.findUserById(sql, userId);
  if (user === null || user.status !== "active" || user.email === null) return null;
  const provedForSession = familyId !== null && (await repo.sessionBegunAfterProof(sql, userId, familyId));
  return { email: user.email, provedForSession };
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
