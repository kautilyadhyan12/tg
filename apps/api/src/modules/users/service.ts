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
  redeemEmailCode,
  requestEmailCode,
  revokeAllSessions,
} from "../auth/service.js";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { bustEntitlements } from "../entitlements/service.js";
// THE repo-wide "what day is it there" helper. Imported rather than copied: a
// second definition of a calendar day would be a second answer to the only
// question a finish date depends on.
import { dayInTz, safeTimeZone } from "../gamification/streak.js";
import { planAnswersFor } from "../plan/answers.js";
import { missingPlanInputs, resolvePlan } from "../plan/maths.js";
import type { UsersEmailSender } from "./email.js";
import * as repo from "./repo.js";
import {
  consentListResponseSchema,
  consentRecordSchema,
  deriveHealthFlags,
  DISCLAIMER_WORDINGS,
  fitnessProfileSchema,
  healthScreeningSchema,
  onboardingAnswersSchema,
  onboardingResponseSchema,
  UNANSWERED_HEALTH_SCREENING,
} from "./schemas.js";
import type {
  ConsentListResponse,
  ConsentRecord,
  FitnessProfile,
  HealthScreening,
  OnboardingAnswers,
  OnboardingResponse,
  PatchOnboardingRequest,
  MissingPlanInput,
  MissingSetupAnswer,
  PlanHealth,
  PlanResponse,
  PutFitnessProfileRequest,
  PutHealthScreeningRequest,
  RecordConsentRequest,
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

/** THE plan for one person, from their stored answers: the one function the
 *  onboarding routes and the macro rings (GET /v1/nutrition/targets) both
 *  read, so the rings and the screens can never show two daily numbers
 *  (ROADMAP 4a-iii). sql-only like getUserSyncContext above, and for the same
 *  reason: NutritionDeps cannot supply UsersDeps. `requestedTimeZone` only
 *  dates the finish; null falls back to the zone the person has stored. */
export async function getUserPlan(sql: Sql, userId: string, requestedTimeZone: string | null): Promise<PlanResponse> {
  return await planOf(sql, userId, await repo.getOnboarding(sql, userId), requestedTimeZone);
}

/** THE flag every plan route reads (ROADMAP 3b): the stored screening as the
 *  plan calculator's health input — null until the screen is answered, which
 *  the calculator treats as "no condition rule yet". sql-only like the two
 *  above, so the plan route (4a) and the nutrition targets can call it. */
export async function getPlanHealth(sql: Sql, userId: string): Promise<PlanHealth | null> {
  const row = await repo.getHealthScreening(sql, userId);
  if (row === null) return null;
  const stored = { hasCondition: row.hasCondition, checkFirst: checkFirstOf(row.checkFirst) };
  return { hasCondition: stored.hasCondition, safeMode: deriveHealthFlags(stored).safeMode };
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

/** Finishing onboarding while setup still lacks an answer (RULINGS 2026-07-19:
 *  the questions come before the training side). Carries the list so the screen
 *  can send the person to the question that is open — the plan's own inputs,
 *  and `health`, the question on screen 8 (4b-i). */
export class OnboardingIncompleteError extends UsersError {
  readonly missing: readonly MissingSetupAnswer[];
  constructor(missing: readonly MissingSetupAnswer[]) {
    super(409, "onboarding_incomplete", "Answer every question before you finish.");
    this.name = "OnboardingIncompleteError";
    this.missing = missing;
  }
}

export interface UsersDeps {
  sql: Sql;
  config: AppConfig;
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
  weightGoal: null,
  exerciseFrequency: null,
  availableEquipment: [],
  sessionDurationMin: null,
  preferredWorkoutTime: null,
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
    weightGoal: body.weightGoal ?? null,
    exerciseFrequency: body.exerciseFrequency ?? null,
    availableEquipment: body.availableEquipment ?? [],
    sessionDurationMin: body.sessionDurationMin ?? null,
    preferredWorkoutTime: body.preferredWorkoutTime ?? null,
    onboardingCompleted: body.onboardingCompleted ?? false,
  });
  // No row = the user was deleted mid-request (the upsert is active-only).
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return toFitnessProfile(row);
}

// ── onboarding v2: save as you go, and the live plan (ROADMAP item 4a) ──────

/** The answers of a person who has saved nothing yet. Every question reads as
 *  unanswered — no defaults anywhere (RULINGS 2026-07-15). */
const EMPTY_ONBOARDING_ANSWERS = {
  weightGoal: null,
  fitnessGoals: [],
  age: null,
  gender: null,
  heightCm: null,
  weightKg: null,
  targetWeightKg: null,
  pace: null,
  dayActivity: null,
  fitnessLevel: null,
  pushUpsMax: null,
  plankHoldSeconds: null,
  trainingDays: null,
  sessionMinutes: null,
  availableEquipment: [],
  onboardingCompleted: false,
  updatedAt: null,
};

/** The two rows as one set of answers. Re-parsed through the shared contract so
 *  the enum columns (plain strings out of Postgres) are narrowed WITHOUT a cast
 *  (R2.2), and a row that violates a 0026 CHECK fails loud rather than being
 *  served (the `toFitnessProfile` argument, for the same reason).
 *
 *  `trainingDays` and `sessionMinutes` are the screens' words for the columns
 *  0006 already owns — the rename happens here and in the repo's write map, and
 *  nowhere else. */
function toOnboardingAnswers(row: repo.OnboardingRow): OnboardingAnswers {
  const p = row.profile;
  if (p === null) {
    return onboardingAnswersSchema.parse({
      ...EMPTY_ONBOARDING_ANSWERS,
      displayName: row.displayName,
      weightKg: row.weightKg,
    });
  }
  return onboardingAnswersSchema.parse({
    displayName: row.displayName,
    weightGoal: p.weightGoal,
    fitnessGoals: p.fitnessGoals,
    age: p.age,
    gender: p.gender,
    heightCm: p.heightCm,
    weightKg: row.weightKg,
    targetWeightKg: p.targetWeightKg,
    pace: p.pace,
    dayActivity: p.dayActivity,
    fitnessLevel: p.fitnessLevel,
    pushUpsMax: p.pushUpsMax,
    plankHoldSeconds: p.plankHoldSeconds,
    trainingDays: p.exerciseFrequency,
    sessionMinutes: p.sessionDurationMin,
    availableEquipment: p.availableEquipment,
    onboardingCompleted: p.onboardingCompleted,
    updatedAt: p.updatedAt.toISOString(),
  });
}

/** Which time zone the day is counted in. The DEVICE's zone wins (RULINGS
 *  2026-07-21: it comes from the device and is never guessed) — the route has
 *  already refused one the runtime does not know, so `requested` is either a
 *  real zone or absent. The person's stored zone is the fallback for a client
 *  that sent none, and UTC is the last resort: the only guess in the ladder,
 *  and the same one every other reader of `users.timezone` makes. */
function resolveTimeZone(requested: string | null, stored: string | null): string {
  return safeTimeZone(requested ?? stored);
}

/** What the PLAN still needs, from the answers as saved. The health screening
 *  is not read: an unanswered health screen is never missing (plan.ts), so it
 *  cannot change this list. */
function missingOnboardingAnswers(row: repo.OnboardingRow, requestedTimeZone: string | null): MissingPlanInput[] {
  const today = dayInTz(new Date(), resolveTimeZone(requestedTimeZone, row.timezone));
  return missingPlanInputs(planAnswersFor({ answers: toOnboardingAnswers(row), health: null, today }));
}

/** What SETUP still needs: the plan's own inputs, and the health question on
 *  screen 8 (4b-i). The plan works without that answer — unanswered simply
 *  applies no condition rule — but finishing must not: a yes turns off the
 *  calorie cut and may turn on Safe mode, so the training side never opens
 *  without it. Read in the caller's transaction, so the check sees exactly the
 *  rows the save is about to commit. */
async function missingSetupAnswers(
  sql: repo.SqlOrTx,
  userId: string,
  row: repo.OnboardingRow,
  requestedTimeZone: string | null,
): Promise<MissingSetupAnswer[]> {
  const missing: MissingSetupAnswer[] = missingOnboardingAnswers(row, requestedTimeZone);
  if ((await repo.getHealthScreening(sql, userId)) === null) missing.push("health");
  return missing;
}

/** THE plan, from the stored answers. "Today" is the SERVER's clock read in the
 *  person's own time zone — a client sends where it is, never what day it is,
 *  so a finish date cannot be moved by a request body (ROADMAP 4a). */
async function planOf(
  sql: Sql,
  userId: string,
  row: repo.OnboardingRow,
  requestedTimeZone: string | null,
): Promise<PlanResponse> {
  const health = await getPlanHealth(sql, userId);
  const today = dayInTz(new Date(), resolveTimeZone(requestedTimeZone, row.timezone));
  return resolvePlan(planAnswersFor({ answers: toOnboardingAnswers(row), health, today }));
}

async function toOnboardingResponse(
  sql: Sql,
  userId: string,
  row: repo.OnboardingRow,
  requestedTimeZone: string | null,
): Promise<OnboardingResponse> {
  return onboardingResponseSchema.parse({
    answers: toOnboardingAnswers(row),
    ...(await planOf(sql, userId, row, requestedTimeZone)),
  });
}

export async function getOnboarding(
  deps: UsersDeps,
  userId: string,
  requestedTimeZone: string | null,
): Promise<OnboardingResponse> {
  const row = await repo.getOnboarding(deps.sql, userId);
  return await toOnboardingResponse(deps.sql, userId, row, requestedTimeZone);
}

/** One screen's save: PATCH semantics — a field the screen did not ask about is
 *  left alone, and an explicit null clears an answer. The reply carries the
 *  plan the new answers produce, so the number on screen is always the one the
 *  server just stored and never a second round trip out of step with it. */
export async function patchOnboarding(
  deps: UsersDeps,
  userId: string,
  body: PatchOnboardingRequest,
  requestedTimeZone: string | null,
): Promise<OnboardingResponse> {
  // Finishing opens the training side, so it is refused while setup still
  // lacks an answer (RULINGS 2026-07-19) — the plan's inputs, and the health
  // question (4b-i). Checked on the answers AS SAVED, inside the save's own
  // transaction: a body that brings the last answer and finishes is accepted,
  // and a refused one writes nothing at all.
  const verify =
    body.onboardingCompleted === true
      ? async (saved: repo.OnboardingRow, tx: repo.SqlOrTx): Promise<void> => {
          const missing = await missingSetupAnswers(tx, userId, saved, requestedTimeZone);
          if (missing.length > 0) throw new OnboardingIncompleteError(missing);
        }
      : undefined;
  const row = await repo.patchOnboarding(deps.sql, userId, body, verify);
  // No row = the user stopped being active mid-request (the write is
  // active-only), the same answer every other write on this surface gives.
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return await toOnboardingResponse(deps.sql, userId, row, requestedTimeZone);
}

/** Settings' "Reset onboarding" (RULINGS 2026-07-20: it wipes every answer).
 *  The reply is the empty wizard's: every question open again, the health one
 *  included since 4b-i put it back on screen 8, bar the weight, which lives in
 *  the weigh-in history and stays, as the name does (repo `deleteOnboarding`
 *  says why, and why the consent log is not touched). */
export async function resetOnboarding(
  deps: UsersDeps,
  userId: string,
  requestedTimeZone: string | null,
): Promise<OnboardingResponse> {
  const row = await repo.deleteOnboarding(deps.sql, userId);
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return await toOnboardingResponse(deps.sql, userId, row, requestedTimeZone);
}

// ── health screening and Safe mode (ROADMAP Stage 1 item 3b) ────────────────

/** The column is a plain string with a CHECK; narrowed once here, failing loud
 *  on a value outside the enum rather than treating it as "cleared". */
function checkFirstOf(raw: string | null): "cleared" | "not_yet" | null {
  if (raw === null) return null;
  if (raw === "cleared" || raw === "not_yet") return raw;
  throw new Error(`user_health_screenings.check_first outside the enum: ${raw}`);
}

/** The response is built from the STORED answer through the one rule
 *  (`deriveHealthFlags`) and re-parsed through the contract, whose refines pin
 *  the derived flags to the answer — so a response that says Safe mode is off
 *  for a "not yet" cannot leave the server. No row is the shared unanswered
 *  shape (`@app/shared`), which the screens fall back to as well, so the two
 *  can never disagree about what "no answer yet" looks like. */
function toHealthScreening(row: repo.HealthScreeningRow | null): HealthScreening {
  if (row === null) return UNANSWERED_HEALTH_SCREENING;
  const stored = { hasCondition: row.hasCondition, checkFirst: checkFirstOf(row.checkFirst) };
  return healthScreeningSchema.parse({
    answered: true,
    ...stored,
    ...deriveHealthFlags(stored),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function getHealthScreening(deps: UsersDeps, userId: string): Promise<HealthScreening> {
  return toHealthScreening(await repo.getHealthScreening(deps.sql, userId));
}

/** PUT = the whole screening replaced; saving again is how the person changes
 *  their mind later (Kd 2026-09-09: changeable once signed in, and everything
 *  that reads it updates at once, because nothing derived is stored). */
export async function putHealthScreening(
  deps: UsersDeps,
  userId: string,
  body: PutHealthScreeningRequest,
): Promise<HealthScreening> {
  const row = await repo.upsertHealthScreening(deps.sql, userId, {
    hasCondition: body.hasCondition,
    checkFirst: body.hasCondition ? (body.checkFirst ?? null) : null,
  });
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return toHealthScreening(row);
}

// ── the consent log ─────────────────────────────────────────────────────────

/** The most rows one GET lists. Exported for its test only. */
export const CONSENT_LIST_LIMIT = 100;

function toConsent(row: repo.ConsentRow): ConsentRecord {
  return consentRecordSchema.parse({ ...row, recordedAt: row.recordedAt.toISOString() });
}

/** Records one tap. The client names the screen and the wording VERSION it
 *  showed; the server writes the text it holds for that version, so the row
 *  can only ever carry words the app has actually shown. An unknown version
 *  is refused: recording a consent to words nobody can produce would be a
 *  record of nothing. */
export async function recordConsent(
  deps: UsersDeps,
  userId: string,
  body: RecordConsentRequest,
): Promise<ConsentRecord> {
  const wording = DISCLAIMER_WORDINGS[body.purpose][body.wordingVersion];
  if (wording === undefined) {
    throw new UsersError(400, "unknown_wording", "That wording version is not one this app has shown.");
  }
  const row = await repo.insertConsent(deps.sql, userId, {
    purpose: body.purpose,
    wordingVersion: body.wordingVersion,
    wording,
    appVersion: body.appVersion,
  });
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  return toConsent(row);
}

/** The newest CONSENT_LIST_LIMIT taps and the person's total, parsed through
 *  the contract so a list shorter than its total is always labelled as such. */
export async function listConsents(deps: UsersDeps, userId: string): Promise<ConsentListResponse> {
  const { rows, total } = await repo.listConsents(deps.sql, userId, CONSENT_LIST_LIMIT);
  return consentListResponseSchema.parse({ consents: rows.map(toConsent), total });
}

/** Deleting an account is confirmed with a code emailed to the account's own
 *  address (there is no password to ask for — Kd 2026-09-07). The address
 *  comes from the signed-in user's own row, never from the request, so a code
 *  can only ever be sent to, and proved for, the account that is deleting. */
export async function requestDeleteCode(
  deps: UsersDeps,
  userId: string,
): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
  const row = await repo.getProfile(deps.sql, userId);
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  if (row.email === null) {
    throw new UsersError(400, "no_email", "This account has no email address, so a code cannot be sent.");
  }
  return await requestEmailCode(
    { sql: deps.sql, config: deps.config, log: deps.log },
    { email: row.email, purpose: "delete_account" },
    (to, code) => deps.emailSender.sendAccountDeleteCodeEmail(to, code),
  );
}

/** Part 4 §5.2 Day 0: prove the deletion code, then soft-delete + close
 *  memberships + drop push tokens (repo, one tx), revoke every session (auth
 *  service), then the undo email. Idempotent past the code: deleting an
 *  already-deleted account is a quiet success — DELETE must never be an
 *  oracle or a retry hazard (R3.5 spirit). */
export async function deleteAccount(
  deps: UsersDeps,
  userId: string,
  code: string,
): Promise<{ emailSent: boolean }> {
  const row = await repo.getProfile(deps.sql, userId);
  if (row === null) throw new UsersError(401, "unauthorized", "authentication required");
  if (row.email === null) {
    throw new UsersError(400, "no_email", "This account has no email address, so a code cannot be checked.");
  }
  await redeemEmailCode(
    { sql: deps.sql, config: deps.config, log: deps.log },
    { email: row.email, purpose: "delete_account", code },
  );
  const deleted = await repo.softDeleteUser(deps.sql, userId);
  // null = the row stopped being active between the profile read above and
  // this write (a racing second tap): quiet success, no second undo email.
  // A repeat DELETE from a deleted session never gets here — authenticate
  // and the active-only profile read both 401 first.
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
