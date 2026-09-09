// P2.6a — users repo owns profile columns only. body_measurements moved to
// nutrition (Part 4 §3.6). Until their modules exist (gyms: P3.10;
// notifications: P5), this file also owns gym_members close and
// push_tokens delete that Part 4 §5.2 Day 0 requires. Auth-owned tables
// (refresh_tokens, one_time_tokens) are NEVER touched here — the users
// service goes through auth's service interface (R7.1).
// Every query is keyed by the owning userId (R3.2).
import type { Sql, TransactionSql } from "postgres";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import type { PatchOnboardingRequest, UpdateProfileRequest } from "./schemas.js";

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
  // Onboarding v2 (migration 0026).
  mainGoal: string | null;
  pace: string | null;
  dayActivity: string | null;
  pushUpsMax: number | null;
  plankHoldSeconds: number | null;
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
  main_goal: string | null;
  pace: string | null;
  day_activity: string | null;
  push_ups_max: number | null;
  plank_hold_seconds: number | null;
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
  mainGoal: r.main_goal,
  pace: r.pace,
  dayActivity: r.day_activity,
  pushUpsMax: r.push_ups_max,
  plankHoldSeconds: r.plank_hold_seconds,
  updatedAt: r.updated_at,
});

/** The columns every fitness-profile read and RETURNING lists, in one place, so
 *  a column added to the row type cannot be silently missing from one of them
 *  (it would arrive `undefined` and map to `undefined`, not null). */
const FITNESS_PROFILE_COLUMNS = [
  "age",
  "gender",
  "height_cm",
  "target_weight_kg",
  "fitness_level",
  "fitness_goals",
  "exercise_frequency",
  "available_equipment",
  "session_duration_min",
  "preferred_workout_time",
  "medical_conditions",
  "onboarding_completed",
  "main_goal",
  "pace",
  "day_activity",
  "push_ups_max",
  "plank_hold_seconds",
  "updated_at",
] as const;

/** Null when the user has not started onboarding (no row) — the common case;
 *  the service turns that into the empty profile. Keyed on userId (R3.2).
 *  Accepts a transaction so the onboarding merge can read its own write. */
export async function getFitnessProfile(
  sql: SqlOrTx,
  userId: string,
): Promise<FitnessProfileRow | null> {
  const rows = await sql<FitnessProfileDbRow[]>`
    SELECT ${sql(FITNESS_PROFILE_COLUMNS)}
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
 *  says nothing about status, since §5.2 soft-deletes.
 *
 *  THE ONBOARDING v2 COLUMNS (0026) ARE DELIBERATELY ABSENT from both the
 *  INSERT list and the DO UPDATE SET: this is the v1 screen's route, which has
 *  no way to ask for a pace or a push-up count, so writing NULL over them would
 *  throw away an answer this form never offered. "Full document" means the
 *  fields THIS contract carries. `patchOnboarding` below owns the rest. */
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
    RETURNING ${sql(FITNESS_PROFILE_COLUMNS)}`;
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

// ── onboarding v2: save as you go (ROADMAP Stage 1 item 4a) ─────────────────

/** The two rows one screen's answers can touch, read back after the write. */
export interface OnboardingRow {
  /** Null until the person has saved at least one profile answer. */
  profile: FitnessProfileRow | null;
  /** users.weight_kg — screen 2 asks it; it lives there unduplicated. */
  weightKg: number | null;
  /** users.timezone — the fallback for a client that sent none (service). */
  timezone: string | null;
}

/** Reads both rows. Keyed on userId; no status filter for the same reason
 *  `getSyncContext` has none — every caller is behind `authenticate`. */
export async function getOnboarding(sql: SqlOrTx, userId: string): Promise<OnboardingRow> {
  const profile = await getFitnessProfile(sql, userId);
  const rows = await sql<{ weight_kg: string | null; timezone: string | null }[]>`
    SELECT weight_kg, timezone FROM users WHERE id = ${userId}`;
  const raw = rows[0]?.weight_kg;
  return { profile, weightKg: raw == null ? null : Number(raw), timezone: rows[0]?.timezone ?? null };
}

/** PATCH semantics, one transaction: a key PRESENT in the parsed body is
 *  written (an explicit null clears the answer), a key ABSENT is left alone.
 *  The profile row and the body weight move together, so a screen can never
 *  half-save.
 *
 *  Two statements rather than one `INSERT … ON CONFLICT DO UPDATE`, because the
 *  column list VARIES with the screen: the upsert form has to name every column
 *  and would write NULL over the answers this screen never asked about — the
 *  exact opposite of what saving as you go means. The row is created empty
 *  first (every column on this table is nullable by design), then only this
 *  screen's columns are set.
 *
 *  Active-only, and this one cannot use the INSERT…SELECT trick: an EXISTING
 *  profile row would still be updatable by a soft-deleted account. The users
 *  row is taken FOR UPDATE first instead (the `updateProfile` pattern), which
 *  both proves the account is active and blocks a concurrent deletion for the
 *  rest of the transaction. Null = not active. */
export async function patchOnboarding(
  sql: Sql,
  userId: string,
  patch: PatchOnboardingRequest,
): Promise<OnboardingRow | null> {
  return await sql.begin(async (tx) => {
    const active = await tx<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${userId} AND status = 'active' FOR UPDATE`;
    if (active[0] === undefined) return null;

    // Fixed field→column map. `trainingDays` and `sessionMinutes` are the
    // screens' words for columns 0006 already owns — renamed on this surface,
    // never duplicated in the table (migration 0026's note).
    const cols: Record<string, string | number | boolean | null | string[]> = {};
    if (patch.age !== undefined) cols["age"] = patch.age;
    if (patch.gender !== undefined) cols["gender"] = patch.gender;
    if (patch.heightCm !== undefined) cols["height_cm"] = patch.heightCm;
    if (patch.targetWeightKg !== undefined) cols["target_weight_kg"] = patch.targetWeightKg;
    if (patch.pace !== undefined) cols["pace"] = patch.pace;
    if (patch.dayActivity !== undefined) cols["day_activity"] = patch.dayActivity;
    if (patch.fitnessLevel !== undefined) cols["fitness_level"] = patch.fitnessLevel;
    if (patch.pushUpsMax !== undefined) cols["push_ups_max"] = patch.pushUpsMax;
    if (patch.plankHoldSeconds !== undefined) cols["plank_hold_seconds"] = patch.plankHoldSeconds;
    if (patch.trainingDays !== undefined) cols["exercise_frequency"] = patch.trainingDays;
    if (patch.sessionMinutes !== undefined) cols["session_duration_min"] = patch.sessionMinutes;
    if (patch.availableEquipment !== undefined) cols["available_equipment"] = patch.availableEquipment;
    if (patch.onboardingCompleted !== undefined) cols["onboarding_completed"] = patch.onboardingCompleted;
    if (patch.mainGoal !== undefined) {
      cols["main_goal"] = patch.mainGoal;
      // THE MIRROR, and it is temporary. The live macro rings still read the
      // v1 `fitness_goals` ARRAY (nutrition/targets.ts), so a person who picks
      // "lose weight" on the new screen 1 must not read as having no goal
      // there. Written in the same statement as `main_goal`, so the two can
      // never disagree. Item 4a-ii moves the rings onto these answers and this
      // line goes with them (migration 0026's note).
      cols["fitness_goals"] = patch.mainGoal === null ? [] : [patch.mainGoal];
    }

    if (Object.keys(cols).length > 0) {
      await tx`
        INSERT INTO user_fitness_profiles (user_id) VALUES (${userId})
        ON CONFLICT (user_id) DO NOTHING`;
      await tx`
        UPDATE user_fitness_profiles SET ${tx(cols)}, updated_at = now()
        WHERE user_id = ${userId}`;
    }
    if (patch.weightKg !== undefined) {
      await tx`UPDATE users SET weight_kg = ${patch.weightKg} WHERE id = ${userId}`;
    }
    return await getOnboarding(tx, userId);
  });
}

// ── health screening (ROADMAP Stage 1 item 3b) ──────────────────────────────

export interface HealthScreeningRow {
  hasCondition: boolean;
  checkFirst: string | null;
  updatedAt: Date;
}

interface HealthScreeningDbRow {
  has_condition: boolean;
  check_first: string | null;
  updated_at: Date;
}

const toHealthScreening = (r: HealthScreeningDbRow): HealthScreeningRow => ({
  hasCondition: r.has_condition,
  checkFirst: r.check_first,
  updatedAt: r.updated_at,
});

/** Null until the health screen has been saved once — the common case before
 *  onboarding; the service turns that into the unanswered shape. Keyed on userId. */
export async function getHealthScreening(sql: SqlOrTx, userId: string): Promise<HealthScreeningRow | null> {
  const rows = await sql<HealthScreeningDbRow[]>`
    SELECT has_condition, check_first, updated_at
    FROM user_health_screenings WHERE user_id = ${userId}`;
  return rows[0] === undefined ? null : toHealthScreening(rows[0]);
}

/** Full replace (PUT), idempotent by construction like the fitness profile,
 *  and active-only the same way: INSERT…SELECT from users, so a deleted user's
 *  write inserts nothing and returns null. The two CHECKs on the table refuse
 *  a contradiction the schema already refused at the boundary. */
export async function upsertHealthScreening(
  sql: Sql,
  userId: string,
  input: { hasCondition: boolean; checkFirst: string | null },
): Promise<HealthScreeningRow | null> {
  const rows = await sql<HealthScreeningDbRow[]>`
    INSERT INTO user_health_screenings (user_id, has_condition, check_first, updated_at)
    SELECT u.id, ${input.hasCondition}, ${input.checkFirst}, now()
    FROM users u WHERE u.id = ${userId} AND u.status = 'active'
    ON CONFLICT (user_id) DO UPDATE SET
      has_condition = EXCLUDED.has_condition,
      check_first = EXCLUDED.check_first,
      updated_at = now()
    RETURNING has_condition, check_first, updated_at`;
  return rows[0] === undefined ? null : toHealthScreening(rows[0]);
}

// ── the consent log ─────────────────────────────────────────────────────────

export interface ConsentRow {
  id: string;
  purpose: string;
  wordingVersion: string;
  wording: string;
  appVersion: string;
  recordedAt: Date;
}

interface ConsentDbRow {
  id: string;
  purpose: string;
  wording_version: string;
  wording: string;
  app_version: string;
  recorded_at: Date;
}

const toConsent = (r: ConsentDbRow): ConsentRow => ({
  id: r.id,
  purpose: r.purpose,
  wordingVersion: r.wording_version,
  wording: r.wording,
  appVersion: r.app_version,
  recordedAt: r.recorded_at,
});

/** Append one tap. Active-only by the same INSERT…SELECT; the wording is the
 *  text the SERVICE looked up for the named version — the row holds it verbatim
 *  so a later edit to the words in code cannot change what was agreed to. */
export async function insertConsent(
  sql: Sql,
  userId: string,
  input: { purpose: string; wordingVersion: string; wording: string; appVersion: string },
): Promise<ConsentRow | null> {
  const rows = await sql<ConsentDbRow[]>`
    INSERT INTO consent_log (user_id, purpose, wording_version, wording, app_version)
    SELECT u.id, ${input.purpose}, ${input.wordingVersion}, ${input.wording}, ${input.appVersion}
    FROM users u WHERE u.id = ${userId} AND u.status = 'active'
    RETURNING id, purpose, wording_version, wording, app_version, recorded_at`;
  return rows[0] === undefined ? null : toConsent(rows[0]);
}

/** The person's own consents, newest first, bounded (a tap is rare; the cap
 *  only keeps a runaway client from making this read unbounded) — with the
 *  count of ALL their rows, so the caller can say when the list is short. */
export async function listConsents(
  sql: Sql,
  userId: string,
  limit: number,
): Promise<{ rows: ConsentRow[]; total: number }> {
  const rows = await sql<ConsentDbRow[]>`
    SELECT id, purpose, wording_version, wording, app_version, recorded_at
    FROM consent_log WHERE user_id = ${userId}
    ORDER BY recorded_at DESC, id DESC
    LIMIT ${limit}`;
  const counted = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM consent_log WHERE user_id = ${userId}`;
  return { rows: rows.map(toConsent), total: counted[0]?.n ?? 0 };
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
