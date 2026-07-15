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
import type { RedisLike } from "../../redis.js";
import { bustEntitlements } from "../entitlements/service.js";
import type { UsersEmailSender } from "./email.js";
import * as repo from "./repo.js";
import { fitnessProfileSchema } from "./schemas.js";
import type {
  FitnessProfile,
  PutFitnessProfileRequest,
  UpdateProfileRequest,
  UserProfile,
} from "./schemas.js";

/** Narrow service-interface export (R7.1) for workouts/gamification: the
 *  users-owned columns the sync path needs (P2.3). */
export async function getUserSyncContext(
  sql: Sql,
  userId: string,
): Promise<repo.UserSyncContext> {
  return await repo.getSyncContext(sql, userId);
}

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
  redis: RedisLike;
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
    onboardingCompleted: row.onboardingCompleted,
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

// ── onboarding / fitness profile (onboarding-storage card) ──────────────────

/** A user who has never saved onboarding has no row. That is the common case,
 *  not an error, so it reads as the empty profile — never a 404. */
const EMPTY_FITNESS_PROFILE: FitnessProfile = {
  age: null,
  gender: null,
  heightCm: null,
  targetWeightKg: null,
  fitnessLevel: null,
  fitnessGoals: [],
  exerciseFrequency: null,
  availableEquipment: [],
  sessionDurationMin: null,
  preferredWorkoutTime: null,
  medicalConditions: null,
  onboardingCompleted: false,
  updatedAt: null,
};

/** The repo returns the enum columns as plain strings (that is all Postgres
 *  tells us). Re-parsing through the shared schema narrows them to their unions
 *  WITHOUT an `as` cast (R2.2) and turns a row that violates the 0006 CHECKs —
 *  e.g. a future migration widening a CHECK without updating the enum — into a
 *  loud failure instead of malformed data served to the client (R1.3). */
function toFitnessProfile(row: repo.FitnessProfileRow | null): FitnessProfile {
  if (row === null) return EMPTY_FITNESS_PROFILE;
  return fitnessProfileSchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() });
}

export async function getFitnessProfile(
  deps: UsersDeps,
  userId: string,
): Promise<FitnessProfile> {
  return toFitnessProfile(await repo.getFitnessProfile(deps.sql, userId));
}

/** PUT = full-document replace: absent field → NULL. The absent→NULL rule lives
 *  HERE (once), so the repo takes a fully-resolved write shape. */
export async function putFitnessProfile(
  deps: UsersDeps,
  userId: string,
  body: PutFitnessProfileRequest,
): Promise<FitnessProfile> {
  const row = await repo.upsertFitnessProfile(deps.sql, userId, {
    age: body.age ?? null,
    gender: body.gender ?? null,
    heightCm: body.heightCm ?? null,
    targetWeightKg: body.targetWeightKg ?? null,
    fitnessLevel: body.fitnessLevel ?? null,
    fitnessGoals: body.fitnessGoals ?? [],
    exerciseFrequency: body.exerciseFrequency ?? null,
    availableEquipment: body.availableEquipment ?? [],
    sessionDurationMin: body.sessionDurationMin ?? null,
    preferredWorkoutTime: body.preferredWorkoutTime ?? null,
    medicalConditions: body.medicalConditions ?? null,
    onboardingCompleted: body.onboardingCompleted ?? false,
  });
  // No row = the user was deleted mid-request (the upsert is active-only).
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return toFitnessProfile(row);
}

/** Part 4 §5.2 Day 0: soft-delete + close memberships + drop push tokens
 *  (repo, one tx), revoke every session (auth service), then the undo email.
 *  Idempotent: deleting an already-deleted account is a quiet success —
 *  DELETE must never be an oracle or a retry hazard (R3.5 spirit). */
export async function deleteAccount(
  deps: UsersDeps,
  userId: string,
): Promise<{ emailSent: boolean }> {
  const deleted = await repo.softDeleteUser(deps.sql, userId);
  // Already deleted: idempotent no-op — and no second undo email.
  if (deleted === null) return { emailSent: false };
  await revokeAllSessions(deps.sql, userId);
  // Memberships just closed = an entitlement change → bust (§4.1/§10 seam).
  await bustEntitlements(deps.redis, userId);
  const rawToken = await issueRestoreToken(deps.sql, userId);
  if (deleted.email !== null) {
    try {
      await deps.emailSender.sendAccountDeletionEmail(deleted.email, deleted.displayName, rawToken);
      return { emailSent: true };
    } catch (err) {
      // R3.10 (T3 2026-07-11 finding 5): provider errors routinely echo the
      // recipient address / message content — log the error CLASS only,
      // never the raw error object from the email path.
      deps.log.warn(
        {
          errName: err instanceof Error ? err.name : typeof err,
          event: "email.account_deletion.send_failed",
          userId,
        },
        "email send failed",
      );
      return { emailSent: false };
    }
  }
  // OAuth-only account without an email: no undo channel — log the event.
  deps.log.warn({ event: "account_deletion.no_email", userId }, "deletion without undo email");
  return { emailSent: false };
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
