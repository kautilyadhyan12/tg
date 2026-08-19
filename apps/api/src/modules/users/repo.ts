// P2.6a — users repo owns profile columns only. body_measurements moved to
// nutrition (Part 4 §3.6). Until their modules exist (gyms: P3.10;
// notifications: P5), this file also owns gym_members close and
// push_tokens delete that Part 4 §5.2 Day 0 requires. Auth-owned tables
// (refresh_tokens, one_time_tokens) are NEVER touched here — the users
// service goes through auth's service interface (R7.1).
// Every query is keyed by the owning userId (R3.2).
import type { Sql, TransactionSql } from "postgres";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import type { UpdateProfileRequest } from "./schemas.js";

/** Reads that run both standalone and inside a tx. postgres.js's Sql and
 *  TransactionSql are siblings, not sub/supertypes — neither is assignable to
 *  the other — so a shared read helper must accept the union. */
type SqlOrTx = Sql | TransactionSql;

export interface ProfileRow {
  id: string;
  email: string | null;
  displayName: string;
  locale: string;
  units: string;
  timezone: string | null;
  weightKg: number | null;
  leaderboardOptOut: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
}

interface ProfileDbRow {
  id: string;
  email: string | null;
  display_name: string;
  locale: string;
  units: string;
  timezone: string | null;
  weight_kg: string | null; // numeric arrives as string
  leaderboard_opt_out: boolean;
  onboarding_completed: boolean;
  created_at: Date;
}

const toProfile = (r: ProfileDbRow): ProfileRow => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  locale: r.locale,
  units: r.units,
  timezone: r.timezone,
  weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
  leaderboardOptOut: r.leaderboard_opt_out,
  onboardingCompleted: r.onboarding_completed,
  createdAt: r.created_at,
});

/** The one profile read. onboarding_completed lives on user_fitness_profiles
 *  (onboarding-storage card), so it arrives by LEFT JOIN and COALESCEs to false
 *  for a user who has not started onboarding — no row is the common case. */
async function selectProfile(sql: SqlOrTx, userId: string): Promise<ProfileRow | null> {
  const rows = await sql<ProfileDbRow[]>`
    SELECT u.id, u.email, u.display_name, u.locale, u.units, u.timezone,
           u.weight_kg, u.leaderboard_opt_out, u.created_at,
           COALESCE(f.onboarding_completed, false) AS onboarding_completed
    FROM users u
    LEFT JOIN user_fitness_profiles f ON f.user_id = u.id
    WHERE u.id = ${userId} AND u.status = 'active'`;
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

export async function getProfile(sql: Sql, userId: string): Promise<ProfileRow | null> {
  return await selectProfile(sql, userId);
}

/** Applies a profile-only PATCH. Measurement history is written exclusively
 * through the nutrition service (Part 4 §3.6). */
export async function updateProfile(
  sql: Sql,
  userId: string,
  patch: UpdateProfileRequest,
): Promise<ProfileRow | null> {
  return await sql.begin(async (tx) => {
    const prevRows = await tx<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${userId} AND status = 'active' FOR UPDATE`;
    const prev = prevRows[0];
    if (prev === undefined) return null;

    // Fixed field→column map; only keys PRESENT in the parsed patch are set.
    const cols: Record<string, string | number | boolean | null> = {};
    if (patch.displayName !== undefined) cols["display_name"] = patch.displayName;
    if (patch.locale !== undefined) cols["locale"] = patch.locale;
    if (patch.units !== undefined) cols["units"] = patch.units;
    if (patch.timezone !== undefined) cols["timezone"] = patch.timezone;
    if (patch.weightKg !== undefined) cols["weight_kg"] = patch.weightKg;
    if (patch.leaderboardOptOut !== undefined) cols["leaderboard_opt_out"] = patch.leaderboardOptOut;

    // RETURNING cannot carry the joined onboarding_completed, so the row is
    // re-read through the one profile select — same tx, so it stays atomic.
    const rows = await tx<{ id: string }[]>`
      UPDATE users SET ${tx(cols)}
      WHERE id = ${userId} AND status = 'active'
      RETURNING id`;
    if (rows[0] === undefined) return null;

    return await selectProfile(tx, userId);
  });
}

// ── onboarding / fitness profile (onboarding-storage card) ──────────────────

export interface FitnessProfileRow {
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  targetWeightKg: number | null;
  fitnessLevel: string | null;
  fitnessGoals: string[];
  exerciseFrequency: number | null;
  availableEquipment: string[];
  sessionDurationMin: number | null;
  preferredWorkoutTime: string | null;
  medicalConditions: string | null;
  onboardingCompleted: boolean;
  updatedAt: Date;
}

interface FitnessProfileDbRow {
  age: number | null;
  gender: string | null;
  height_cm: string | null; // numeric arrives as string
  target_weight_kg: string | null;
  fitness_level: string | null;
  fitness_goals: string[] | null;
  exercise_frequency: number | null;
  available_equipment: string[] | null;
  session_duration_min: number | null;
  preferred_workout_time: string | null;
  medical_conditions: string | null;
  onboarding_completed: boolean;
  updated_at: Date;
}

const toFitnessProfile = (r: FitnessProfileDbRow): FitnessProfileRow => ({
  age: r.age,
  gender: r.gender,
  heightCm: r.height_cm === null ? null : Number(r.height_cm),
  targetWeightKg: r.target_weight_kg === null ? null : Number(r.target_weight_kg),
  fitnessLevel: r.fitness_level,
  fitnessGoals: r.fitness_goals ?? [],
  exerciseFrequency: r.exercise_frequency,
  availableEquipment: r.available_equipment ?? [],
  sessionDurationMin: r.session_duration_min,
  preferredWorkoutTime: r.preferred_workout_time,
  medicalConditions: r.medical_conditions,
  onboardingCompleted: r.onboarding_completed,
  updatedAt: r.updated_at,
});

/** Null when the user has not started onboarding (no row) — the common case;
 *  the service turns that into the empty profile. Keyed on userId (R3.2). */
export async function getFitnessProfile(
  sql: Sql,
  userId: string,
): Promise<FitnessProfileRow | null> {
  const rows = await sql<FitnessProfileDbRow[]>`
    SELECT age, gender, height_cm, target_weight_kg, fitness_level,
           fitness_goals, exercise_frequency, available_equipment,
           session_duration_min, preferred_workout_time, medical_conditions,
           onboarding_completed, updated_at
    FROM user_fitness_profiles WHERE user_id = ${userId}`;
  return rows[0] === undefined ? null : toFitnessProfile(rows[0]);
}

/** Full-document upsert (PUT semantics): an absent field is written as NULL, so
 *  the same body twice yields the same row — idempotent by construction (R3.5),
 *  which is why no Idempotency-Key is needed here.
 *
 *  INSERT…SELECT-from-users is what enforces "active user only" ATOMICALLY: a
 *  deleted user's SELECT yields no row, so nothing inserts, no conflict fires,
 *  and RETURNING is empty → null. A check-then-insert would be a TOCTOU race
 *  against a concurrent account deletion. The FK guarantees the user EXISTS but
 *  says nothing about status, since §5.2 soft-deletes. */
export async function upsertFitnessProfile(
  sql: Sql,
  userId: string,
  input: FitnessProfileWrite,
): Promise<FitnessProfileRow | null> {
  const rows = await sql<FitnessProfileDbRow[]>`
    INSERT INTO user_fitness_profiles
      (user_id, age, gender, height_cm, target_weight_kg, fitness_level,
       fitness_goals, exercise_frequency, available_equipment,
       session_duration_min, preferred_workout_time, medical_conditions,
       onboarding_completed, updated_at)
    SELECT u.id, ${input.age}, ${input.gender}, ${input.heightCm},
           ${input.targetWeightKg}, ${input.fitnessLevel}, ${input.fitnessGoals},
           ${input.exerciseFrequency}, ${input.availableEquipment},
           ${input.sessionDurationMin}, ${input.preferredWorkoutTime},
           ${input.medicalConditions}, ${input.onboardingCompleted}, now()
    FROM users u WHERE u.id = ${userId} AND u.status = 'active'
    ON CONFLICT (user_id) DO UPDATE SET
      age = EXCLUDED.age,
      gender = EXCLUDED.gender,
      height_cm = EXCLUDED.height_cm,
      target_weight_kg = EXCLUDED.target_weight_kg,
      fitness_level = EXCLUDED.fitness_level,
      fitness_goals = EXCLUDED.fitness_goals,
      exercise_frequency = EXCLUDED.exercise_frequency,
      available_equipment = EXCLUDED.available_equipment,
      session_duration_min = EXCLUDED.session_duration_min,
      preferred_workout_time = EXCLUDED.preferred_workout_time,
      medical_conditions = EXCLUDED.medical_conditions,
      onboarding_completed = EXCLUDED.onboarding_completed,
      updated_at = now()
    RETURNING age, gender, height_cm, target_weight_kg, fitness_level,
              fitness_goals, exercise_frequency, available_equipment,
              session_duration_min, preferred_workout_time, medical_conditions,
              onboarding_completed, updated_at`;
  return rows[0] === undefined ? null : toFitnessProfile(rows[0]);
}

/** The write shape the repo accepts: every field resolved to a value or NULL by
 *  the service, so the repo never re-implements PUT's absent→NULL rule. */
export interface FitnessProfileWrite {
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  targetWeightKg: number | null;
  fitnessLevel: string | null;
  fitnessGoals: string[];
  exerciseFrequency: number | null;
  availableEquipment: string[];
  sessionDurationMin: number | null;
  preferredWorkoutTime: string | null;
  medicalConditions: string | null;
  onboardingCompleted: boolean;
}

export interface UserSyncContext {
  weightKg: number | null;
  timezone: string | null;
  displayName: string;
  units: string;
}

/** Weight (2B §2.2 calorie lever) + timezone (Part 7 §3.1 day-bucketing) for
 *  the workouts/gamification sync path; displayName/units feed the coach
 *  prompt (P2.5b GAP-1 — only stored fields). No status filter: callers are
 *  behind authenticate (active-only), and reads must not flap mid-request. */
export async function getSyncContext(sql: Sql, userId: string): Promise<UserSyncContext> {
  const rows = await sql<
    { weight_kg: string | null; timezone: string | null; display_name: string; units: string }[]
  >`
    SELECT weight_kg, timezone, display_name, units FROM users WHERE id = ${userId}`;
  const r = rows[0];
  return {
    weightKg: r?.weight_kg == null ? null : Number(r.weight_kg),
    timezone: r?.timezone ?? null,
    displayName: r?.display_name ?? "",
    units: r?.units ?? "metric",
  };
}

export interface DeletedUserRow {
  email: string | null;
  displayName: string;
}

/** Part 4 §5.2 Day 0, users-owned part, one transaction: soft-delete the row,
 *  close memberships, delete push tokens. Refresh-token revocation is the
 *  auth module's (service call, in users/service.ts). Returns null when the
 *  user was not active (already deleted → idempotent no-op). */
export async function softDeleteUser(sql: Sql, userId: string): Promise<DeletedUserRow | null> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ email: string | null; display_name: string }[]>`
      UPDATE users SET status = 'deleted', deleted_at = now()
      WHERE id = ${userId} AND status = 'active'
      RETURNING email, display_name`;
    const row = rows[0];
    if (row === undefined) return null;
    // T3 L-4 — THE ORDER OF THESE TWO STATEMENTS IS LOAD-BEARING AND WAS
    // BACKWARDS. The join card decides lock order ONCE — application, then
    // gym_members — because `confirmApplication` locks the application row and
    // then inserts a membership whose `ON CONFLICT` waits on any uncommitted
    // conflicting tuple. This transaction is a THIRD writer of the same two
    // rows and took them the other way round, so for a person holding both a
    // live membership and a pending application in one gym the two could form
    // a cycle and Postgres would abort one with 40P01 — a 500 for whoever
    // lost. Cancelling applications FIRST puts every writer on one order.
    // **The cycle itself is UNREPRODUCED** (it needs two transactions
    // interleaved at one statement); what IS verified is the premise — the two
    // orders differed, and now they do not. Two lines, strictly safer.
    //
    // Kd ruling :11072 added the waiting room, and this is its Day-0 half:
    // without it a deleted person's NAME sits in a gym's confirm queue for two
    // weeks, and a front-desk tap could make them a member of a gym they left
    // the product to get away from. Not a widening of §5.2's delete list — it
    // is the membership close §5.2 already mandates, applied to the row that
    // stands in for a membership.
    await tx`
      UPDATE gym_join_applications
      SET status = 'cancelled', decided_at = now()
      WHERE user_id = ${userId} AND status = 'pending'`;
    // Part 4 §5.2's Day-0 membership close, and the reason BOTH of these are
    // written inline rather than called from the orgs repo: R7.1 forbids
    // reaching into another module's repo, and the DPDP cascade is
    // cross-cutting by nature — which is why this statement has always been
    // inline. The orgs repo's own header claim to be "the ONLY file that
    // touches" these tables was already false because of it; that sentence is
    // corrected there rather than left to read as a rule these two break.
    await tx`
      UPDATE gym_members SET removed_at = now()
      WHERE user_id = ${userId} AND removed_at IS NULL`;
    await tx`DELETE FROM push_tokens WHERE user_id = ${userId}`;
    return { email: row.email, displayName: row.display_name };
  });
}

/** Undo inside the §5.2 window (Part 4 §5.2): only a soft-deleted row whose
 *  deleted_at is younger than the retention window flips back. The window is
 *  enforced HERE as well as by the token TTL — belt and braces. Gym
 *  memberships closed at Day 0 deliberately STAY closed (rejoin by code) —
 *  auto-reopen could exceed seat caps (DECISIONS 2026-07-11, T3 finding 4;
 *  revisit at P3.10).
 *  The window comes from src/retention.ts so the undo window, the restore
 *  token's TTL, the user-facing copy and the Day-14 purge can never disagree
 *  — an interval literal cannot be parameterised, hence the multiplication. */
export async function restoreUser(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE users SET status = 'active', deleted_at = NULL
    WHERE id = ${userId} AND status = 'deleted'
      AND deleted_at > now() - (${DPDP_RETENTION_DAYS} * interval '1 day')
    RETURNING id`;
  return rows.length > 0;
}
