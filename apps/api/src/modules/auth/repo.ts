// P2.1 — auth repo: the ONLY file that touches users / refresh_tokens /
// one_time_tokens for this module (v1 §6.2, R4.6). Every query is keyed by
// the owning identity or an unguessable token hash — no fetch-by-id-alone of
// tenant data leaves this file unscoped (R3.2).
import type { Sql } from "postgres";

/** The password-hash algorithms users.hash_algo may hold (identity.ts §3.1
 *  CHECK). Owned here because it types the DB row; the service imports it. */
export type HashAlgo = "bcrypt" | "argon2id";

export interface UserAuthRow {
  id: string;
  email: string | null;
  passwordHash: string | null;
  hashAlgo: HashAlgo | null;
  displayName: string;
  status: string;
  locale: string;
  units: string;
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

// 'restore_account' added by migration 0004 (P2.2 CORRECTION 1; Part 4 §5.2 undo flow).
export type OneTimePurpose = "verify_email" | "password_reset" | "restore_account";

interface UserAuthDbRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  hash_algo: string | null;
  display_name: string;
  status: string;
  locale: string;
  units: string;
}

/** users.hash_algo is nullable text. A non-null password_hash always carries a
 *  valid algo (migration invariant, tools/migrate-mongo/collections/users.ts:65);
 *  anything unexpected maps to null and the service fails such a login closed. */
const toHashAlgo = (v: string | null): HashAlgo | null =>
  v === "bcrypt" || v === "argon2id" ? v : null;

const userAuthColumns = (row: UserAuthDbRow): UserAuthRow => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  hashAlgo: toHashAlgo(row.hash_algo),
  displayName: row.display_name,
  status: row.status,
  locale: row.locale,
  units: row.units,
});

export async function findUserByEmail(sql: Sql, email: string): Promise<UserAuthRow | null> {
  const rows = await sql<UserAuthDbRow[]>`
    SELECT id, email, password_hash, hash_algo, display_name, status, locale, units
    FROM users WHERE email = ${email}`; // citext: case-insensitive match
  return rows[0] === undefined ? null : userAuthColumns(rows[0]);
}

export async function findUserById(sql: Sql, userId: string): Promise<UserAuthRow | null> {
  const rows = await sql<UserAuthDbRow[]>`
    SELECT id, email, password_hash, hash_algo, display_name, status, locale, units
    FROM users WHERE id = ${userId}`;
  return rows[0] === undefined ? null : userAuthColumns(rows[0]);
}

/** null = email already taken (23505 on users_email_unique). */
export async function createUser(
  sql: Sql,
  input: { email: string; passwordHash: string; algo: HashAlgo; displayName: string },
): Promise<string | null> {
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, hash_algo, display_name)
      VALUES (${input.email}, ${input.passwordHash}, ${input.algo}, ${input.displayName})
      RETURNING id`;
    return rows[0]?.id ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // TS narrows via the `in` check — no cast needed (R2.2).
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

export async function setPasswordHash(
  sql: Sql,
  userId: string,
  passwordHash: string,
  algo: HashAlgo,
): Promise<void> {
  await sql`
    UPDATE users SET password_hash = ${passwordHash}, hash_algo = ${algo}
    WHERE id = ${userId}`;
}

// ── OAuth identities (auth_identities; identity.ts §3.1 "Google today") ──────

/** The user linked to this provider identity, or null. */
export async function findUserIdByAuthIdentity(
  sql: Sql,
  provider: string,
  subject: string,
): Promise<string | null> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM auth_identities
    WHERE provider = ${provider} AND subject = ${subject}`;
  return rows[0]?.user_id ?? null;
}

/** Create a user with NO password: password_hash / hash_algo stay NULL
 *  (identity.ts: both nullable). Google sign-in and the email-code door both
 *  create accounts this way. null = email already taken (23505), so the
 *  service re-resolves instead. */
export async function createPasswordlessUser(
  sql: Sql,
  input: { email: string; displayName: string },
): Promise<string | null> {
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name)
      VALUES (${input.email}, ${input.displayName})
      RETURNING id`;
    return rows[0]?.id ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

/** Idempotent link (ON CONFLICT on auth_identities_provider_subject_uq): a
 *  replayed callback is a no-op, never a 23505. */
export async function linkAuthIdentity(
  sql: Sql,
  input: { userId: string; provider: string; subject: string },
): Promise<void> {
  await sql`
    INSERT INTO auth_identities (user_id, provider, subject)
    VALUES (${input.userId}, ${input.provider}, ${input.subject})
    ON CONFLICT (provider, subject) DO NOTHING`;
}

/** Marks an account's email verified by writing a CONSUMED verify_email
 *  token — the exact shape isEmailVerified() derives from (DECISIONS
 *  2026-07-11: users has NO verified column). Google asserts the email, and a
 *  proved sign-in code proves it too, so this is the faithful port of the old
 *  `isEmailVerified: true` (passport.js:47,60) WITHOUT inventing a schema field
 *  (R0.2). token_hash is a random marker, never emailed and never consumable. */
export async function recordVerifiedEmail(
  sql: Sql,
  userId: string,
  markerHash: string,
): Promise<void> {
  await sql`
    INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
    VALUES (${userId}, 'verify_email', ${markerHash}, now(), now())`;
}

// ── refresh tokens (rotation + reuse detection, v1 §6.1 / Part 4 §3.1) ──────

export async function insertRefreshToken(
  sql: Sql,
  input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, ip, user_agent)
    VALUES (${input.userId}, ${input.familyId}, ${input.tokenHash}, ${input.expiresAt},
            ${input.ip}, ${input.userAgent})
    RETURNING id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("refresh token insert returned no row");
  return id;
}

export async function findRefreshTokenByHash(
  sql: Sql,
  tokenHash: string,
): Promise<RefreshTokenRow | null> {
  const rows = await sql<
    { id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null }[]
  >`SELECT id, user_id, family_id, expires_at, revoked_at
    FROM refresh_tokens WHERE token_hash = ${tokenHash}`;
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    userId: r.user_id,
    familyId: r.family_id,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  };
}

/** Two concurrent presentations of the same refresh token raced past the
 *  service-level revokedAt check (T3 2026-07-11) — the transaction below is
 *  the arbiter now; this signals "lost" so the service kills the family. */
export class RefreshRotationRaceError extends Error {
  constructor() {
    super("refresh token was concurrently rotated or revoked");
    this.name = "RefreshRotationRaceError";
  }
}

/** Rotation, atomically: insert the successor, then revoke the presented
 *  token WHERE revoked_at IS NULL. Zero rows revoked = someone else rotated
 *  or revoked it first (reuse/race) → the transaction rolls back (the
 *  successor never becomes live) and RefreshRotationRaceError is thrown.
 *  Concurrent duplicates serialize on the old row's lock: exactly one wins. */
export async function rotateRefreshToken(
  sql: Sql,
  input: {
    oldId: string;
    userId: string;
    familyId: string;
    newTokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, ip, user_agent)
      VALUES (${input.userId}, ${input.familyId}, ${input.newTokenHash}, ${input.expiresAt},
              ${input.ip}, ${input.userAgent})
      RETURNING id`;
    const newId = rows[0]?.id;
    if (newId === undefined) throw new Error("refresh token rotation insert returned no row");
    const revoked = await tx<{ id: string }[]>`
      UPDATE refresh_tokens SET revoked_at = now(), replaced_by = ${newId}
      WHERE id = ${input.oldId} AND user_id = ${input.userId} AND revoked_at IS NULL
      RETURNING id`;
    if (revoked.length === 0) throw new RefreshRotationRaceError();
  });
}

/** Reuse detection (Part 4 §3.1: "reuse of a revoked member kills the family"). */
export async function revokeFamily(sql: Sql, userId: string, familyId: string): Promise<void> {
  await sql`
    UPDATE refresh_tokens SET revoked_at = now()
    WHERE user_id = ${userId} AND family_id = ${familyId} AND revoked_at IS NULL`;
}

/** "Log out everywhere" (§3.1 read shape) — reset/change-password sweeps. */
export async function revokeAllRefreshTokens(sql: Sql, userId: string): Promise<void> {
  await sql`
    UPDATE refresh_tokens SET revoked_at = now()
    WHERE user_id = ${userId} AND revoked_at IS NULL`;
}

// ── one-time tokens (hashed; migration 0003, R3.7) ──────────────────────────

/** Issuing a new token invalidates the user's previous unused ones of the
 *  same purpose — ports the old single-field-overwrite semantics
 *  (authController.js:210: only the latest reset link works). Invalidation
 *  expires the token (expires_at = now()); used_at means CONSUMED only —
 *  isEmailVerified must never count a superseded token (T3 2026-07-11). */
export async function createOneTimeToken(
  sql: Sql,
  input: { userId: string; purpose: OneTimePurpose; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE one_time_tokens SET expires_at = now()
      WHERE user_id = ${input.userId} AND purpose = ${input.purpose}
        AND used_at IS NULL AND expires_at > now()`;
    await tx`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at)
      VALUES (${input.userId}, ${input.purpose}, ${input.tokenHash}, ${input.expiresAt})`;
  });
}

/** Atomic single-use consume: returns the owning userId, or null if the hash
 *  is unknown, already used, or expired (one UPDATE — no check-then-use race). */
export async function consumeOneTimeToken(
  sql: Sql,
  purpose: OneTimePurpose,
  tokenHash: string,
): Promise<string | null> {
  const rows = await sql<{ user_id: string }[]>`
    UPDATE one_time_tokens SET used_at = now()
    WHERE token_hash = ${tokenHash} AND purpose = ${purpose}
      AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  return rows[0]?.user_id ?? null;
}

// ── sign-in codes (migration 0023; Kd 2026-09-07) ───────────────────────────
// Keyed on the ADDRESS: every read below carries `email` AND `purpose` in its
// WHERE, so a code asked for by one address can never be found through another
// (R3.2 in the shape this table has — the address is the tenant).

export type CodePurpose = "sign_in" | "delete_account";

export interface SignInCodeRow {
  id: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface SignInCodeDbRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

const signInCodeColumns = (r: SignInCodeDbRow): SignInCodeRow => ({
  id: r.id,
  codeHash: r.code_hash,
  attempts: r.attempts,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
  createdAt: r.created_at,
});

/** Issue a code, in ONE transaction under a per-address lock:
 *    1. take an advisory lock on (address, purpose) — two requests for one
 *       address arriving together serialise here, so both cannot read "one
 *       code so far" and both issue (the day cap would otherwise be three);
 *    2. prune every row older than `pruneBefore` (the table's privacy
 *       guarantee — see the migration);
 *    3. read this address's codes since `since` (used or not, live or dead:
 *       the daily cap counts SENDS) and hand them to `check`, which THROWS to
 *       refuse — the transaction rolls back and nothing was written;
 *    4. retire this address's live code of the same purpose (a resend
 *       REPLACES, Kd's ruling) and insert the new one.
 *  Returns the new row's id so a failed send can take it back. */
export async function issueCode(
  sql: Sql,
  input: {
    email: string;
    purpose: CodePurpose;
    codeHash: string;
    expiresAt: Date;
    pruneBefore: Date;
    since: Date;
    check: (recent: SignInCodeRow[]) => void;
  },
): Promise<string> {
  return await sql.begin(async (tx) => {
    // hashtext is int4; the lock takes a bigint, and the cast is implicit.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`${input.email}|${input.purpose}`}))`;
    await tx`DELETE FROM sign_in_codes WHERE created_at < ${input.pruneBefore}`;
    const recent = await tx<SignInCodeDbRow[]>`
      SELECT id, code_hash, attempts, expires_at, used_at, created_at
      FROM sign_in_codes
      WHERE email = ${input.email} AND purpose = ${input.purpose} AND created_at >= ${input.since}
      ORDER BY created_at DESC`;
    input.check(recent.map(signInCodeColumns));
    await tx`
      UPDATE sign_in_codes SET expires_at = now()
      WHERE email = ${input.email} AND purpose = ${input.purpose}
        AND used_at IS NULL AND expires_at > now()`;
    const rows = await tx<{ id: string }[]>`
      INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at)
      VALUES (${input.email}, ${input.purpose}, ${input.codeHash}, ${input.expiresAt})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("sign-in code insert returned no row");
    return id;
  });
}

/** A code whose email never went out must not count against the day's two. */
export async function deleteCode(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM sign_in_codes WHERE id = ${id}`;
}

/** The one code this address may still prove: unused and unexpired. */
export async function findLiveCode(
  sql: Sql,
  email: string,
  purpose: CodePurpose,
): Promise<SignInCodeRow | null> {
  const rows = await sql<SignInCodeDbRow[]>`
    SELECT id, code_hash, attempts, expires_at, used_at, created_at
    FROM sign_in_codes
    WHERE email = ${email} AND purpose = ${purpose}
      AND used_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1`;
  return rows[0] === undefined ? null : signInCodeColumns(rows[0]);
}

/** One wrong guess, atomically: bump the count and, on the last allowed one,
 *  kill the code in the same statement. Returns the new count. */
export async function recordFailedAttempt(
  sql: Sql,
  id: string,
  maxAttempts: number,
): Promise<number> {
  const rows = await sql<{ attempts: number }[]>`
    UPDATE sign_in_codes
    SET attempts = attempts + 1,
        expires_at = CASE WHEN attempts + 1 >= ${maxAttempts} THEN now() ELSE expires_at END
    WHERE id = ${id}
    RETURNING attempts`;
  return rows[0]?.attempts ?? maxAttempts;
}

/** Single use, one UPDATE — a code presented twice at once is consumed once. */
export async function consumeCode(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE sign_in_codes SET used_at = now()
    WHERE id = ${id} AND used_at IS NULL AND expires_at > now()
    RETURNING id`;
  return rows.length > 0;
}

/** emailVerified is DERIVED from a consumed verify_email token — users has no
 *  verified column in the Part 4 §3.1 DDL (DECISIONS 2026-07-11). */
export async function isEmailVerified(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM one_time_tokens
    WHERE user_id = ${userId} AND purpose = 'verify_email' AND used_at IS NOT NULL
    LIMIT 1`;
  return rows.length > 0;
}
