// P2.2 — users service (v1 §6.1 users module): full profile, preferences,
// DPDP Day-0 deletion + 14-day undo (Part 4 §5.2). Auth-owned mechanics
// (one-time tokens, session revocation, emailVerified derivation) are reached
// ONLY through auth's service interface (R7.1) — never its repo or tables.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import {
  consumeRestoreToken,
  isUserEmailVerified,
  issueRestoreToken,
  revokeAllSessions,
} from "../auth/service.js";
import type { UsersEmailSender } from "./email.js";
import * as repo from "./repo.js";
import type { UpdateProfileRequest, UserProfile } from "./schemas.js";

/** Typed failure for the central error mapper (R8.1); message client-safe. */
export class UsersError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "UsersError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UsersDeps {
  sql: Sql;
  emailSender: UsersEmailSender;
  log: FastifyBaseLogger;
}

async function toUserProfile(sql: Sql, row: repo.ProfileRow): Promise<UserProfile> {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: await isUserEmailVerified(sql, row.id),
    locale: row.locale,
    units: row.units,
    timezone: row.timezone,
    weightKg: row.weightKg,
    leaderboardOptOut: row.leaderboardOptOut,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getProfile(deps: UsersDeps, userId: string): Promise<UserProfile> {
  const row = await repo.getProfile(deps.sql, userId);
  // authenticate already proved active; a null here means deleted mid-request.
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return await toUserProfile(deps.sql, row);
}

export async function updateProfile(
  deps: UsersDeps,
  userId: string,
  patch: UpdateProfileRequest,
): Promise<UserProfile> {
  const row = await repo.updateProfile(deps.sql, userId, patch);
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return await toUserProfile(deps.sql, row);
}

/** Part 4 §5.2 Day 0: soft-delete + close memberships + drop push tokens
 *  (repo, one tx), revoke every session (auth service), then the undo email.
 *  Idempotent: deleting an already-deleted account is a quiet success —
 *  DELETE must never be an oracle or a retry hazard (R3.5 spirit). */
export async function deleteAccount(deps: UsersDeps, userId: string): Promise<void> {
  const deleted = await repo.softDeleteUser(deps.sql, userId);
  if (deleted === null) return;
  await revokeAllSessions(deps.sql, userId);
  const rawToken = await issueRestoreToken(deps.sql, userId);
  if (deleted.email !== null) {
    try {
      await deps.emailSender.sendAccountDeletionEmail(deleted.email, deleted.displayName, rawToken);
    } catch (err) {
      // R2.5/R3.10: event name + userId only — never token/address.
      deps.log.warn({ err, event: "email.account_deletion.send_failed", userId }, "email send failed");
    }
  } else {
    // OAuth-only account without an email: no undo channel — log the event.
    deps.log.warn({ event: "account_deletion.no_email", userId }, "deletion without undo email");
  }
}

/** Undo (Part 4 §5.2): token consume and window check are BOTH enforced;
 *  every failure mode is the same uniform 400 — no oracle for token validity
 *  vs. window expiry vs. unknown account. */
export async function restoreAccount(deps: UsersDeps, rawToken: string): Promise<void> {
  const invalid = () => new UsersError(400, "invalid_token", "Invalid or expired restore token");
  const userId = await consumeRestoreToken(deps.sql, rawToken);
  if (userId === null) throw invalid();
  const restored = await repo.restoreUser(deps.sql, userId);
  if (!restored) throw invalid();
}
