// P2.1 — auth repo: the ONLY file that touches users / refresh_tokens /
// one_time_tokens for this module (v1 §6.2, R4.6). Every query is keyed by
// the owning identity or an unguessable token hash — no fetch-by-id-alone of
// tenant data leaves this file unscoped (R3.2).
import type { Sql } from "postgres";

export interface UserAuthRow {
  id: string;
  email: string | null;
  passwordHash: string | null;
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

export type OneTimePurpose = "verify_email" | "password_reset";

interface UserAuthDbRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string;
  status: string;
  locale: string;
  units: string;
}

const userAuthColumns = (row: UserAuthDbRow): UserAuthRow => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  displayName: row.display_name,
  status: row.status,
  locale: row.locale,
  units: row.units,
});

export async function findUserByEmail(sql: Sql, email: string): Promise<UserAuthRow | null> {
  const rows = await sql<UserAuthDbRow[]>`
    SELECT id, email, password_hash, display_name, status, locale, units
    FROM users WHERE email = ${email}`; // citext: case-insensitive match
  return rows[0] === undefined ? null : userAuthColumns(rows[0]);
}

export async function findUserById(sql: Sql, userId: string): Promise<UserAuthRow | null> {
  const rows = await sql<UserAuthDbRow[]>`
    SELECT id, email, password_hash, display_name, status, locale, units
    FROM users WHERE id = ${userId}`;
  return rows[0] === undefined ? null : userAuthColumns(rows[0]);
}

/** null = email already taken (23505 on users_email_unique). */
export async function createUser(
  sql: Sql,
  input: { email: string; passwordHash: string; displayName: string },
): Promise<string | null> {
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, hash_algo, display_name)
      VALUES (${input.email}, ${input.passwordHash}, 'bcrypt', ${input.displayName})
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

export async function setPasswordHash(sql: Sql, userId: string, passwordHash: string): Promise<void> {
  await sql`
    UPDATE users SET password_hash = ${passwordHash}, hash_algo = 'bcrypt'
    WHERE id = ${userId}`;
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

/** emailVerified is DERIVED from a consumed verify_email token — users has no
 *  verified column in the Part 4 §3.1 DDL (DECISIONS 2026-07-11). */
export async function isEmailVerified(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM one_time_tokens
    WHERE user_id = ${userId} AND purpose = 'verify_email' AND used_at IS NOT NULL
    LIMIT 1`;
  return rows.length > 0;
}
