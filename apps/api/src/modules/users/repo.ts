// P2.6a — users repo owns profile columns only. Body weight is not one of
// them: it lives only in the history (nutrition/repo.ts, RULINGS 2026-09-10),
// which this file reads through `currentWeightKg` and writes through
// `recordTypedWeight`. Until their modules exist (gyms: P3.10;
// notifications: P5), this file also owns gym_members close and
// push_tokens delete that Part 4 §5.2 Day 0 requires. Auth-owned tables
// (refresh_tokens, one_time_tokens) are NEVER touched here — the users
// service goes through auth's service interface (R7.1).
// Every query is keyed by the owning userId (R3.2).
import type { Sql, TransactionSql } from "postgres";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import { currentWeightKg, recordTypedWeight } from "../nutrition/repo.js";
import type { PatchOnboardingRequest, UpdateProfileRequest } from "./schemas.js";

/** Reads that run both standalone and inside a tx. postgres.js's Sql and
 *  TransactionSql are siblings, not sub/supertypes — neither is assignable to
 *  the other — so a shared read helper must accept the union. Exported for the
 *  service's finish check, which runs inside `patchOnboarding`'s transaction. */
export type SqlOrTx = Sql | TransactionSql;

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
  leaderboard_opt_out: boolean;
  onboarding_completed: boolean;
  created_at: Date;
}

const toProfile = (r: ProfileDbRow, weightKg: number | null): ProfileRow => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  locale: r.locale,
  units: r.units,
  timezone: r.timezone,
  weightKg,
  leaderboardOptOut: r.leaderboard_opt_out,
  onboardingCompleted: r.onboarding_completed,
  createdAt: r.created_at,
});

/** The one profile read. onboarding_completed lives on user_fitness_profiles
 *  (onboarding-storage card), so it arrives by LEFT JOIN and COALESCEs to false
 *  for a user who has not started onboarding — no row is the common case. The
 *  weight is the history's newest weight-bearing row, read fresh every time. */
async function selectProfile(sql: SqlOrTx, userId: string): Promise<ProfileRow | null> {
  const rows = await sql<ProfileDbRow[]>`
    SELECT u.id, u.email, u.display_name, u.locale, u.units, u.timezone,
           u.leaderboard_opt_out, u.created_at,
           COALESCE(f.onboarding_completed, false) AS onboarding_completed
    FROM users u
    LEFT JOIN user_fitness_profiles f ON f.user_id = u.id
    WHERE u.id = ${userId} AND u.status = 'active'`;
  const row = rows[0];
  return row === undefined ? null : toProfile(row, await currentWeightKg(sql, userId));
}

export async function getProfile(sql: Sql, userId: string): Promise<ProfileRow | null> {
  return await selectProfile(sql, userId);
}

/** Applies a profile PATCH. The users row is locked first — active-only, and
 *  a concurrent deletion waits — then the columns, then the weight as a row
 *  of the history (`recordTypedWeight`). NO KEY UPDATE for the reason
 *  `patchOnboarding` records: plain FOR UPDATE would make every foreign-key
 *  check on this person (a meal, a workout, a weigh-in) wait behind the save. */
export async function updateProfile(
  sql: Sql,
  userId: string,
  patch: UpdateProfileRequest,
): Promise<ProfileRow | null> {
  return await sql.begin(async (tx) => {
    const prevRows = await tx<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${userId} AND status = 'active' FOR NO KEY UPDATE`;
    const prev = prevRows[0];
    if (prev === undefined) return null;

    // Fixed field→column map; only keys PRESENT in the parsed patch are set.
    const cols: Record<string, string | number | boolean | null> = {};
    if (patch.displayName !== undefined) cols["display_name"] = patch.displayName;
    if (patch.locale !== undefined) cols["locale"] = patch.locale;
    if (patch.units !== undefined) cols["units"] = patch.units;
    if (patch.timezone !== undefined) cols["timezone"] = patch.timezone;
    if (patch.leaderboardOptOut !== undefined) cols["leaderboard_opt_out"] = patch.leaderboardOptOut;

    if (Object.keys(cols).length > 0) {
      await tx`
        UPDATE users SET ${tx(cols)}
        WHERE id = ${userId} AND status = 'active'`;
    }
    // A typed weight is a row of the history, the only place weight lives
    // (nutrition/repo.ts recordTypedWeight).
    if (patch.weightKg !== undefined) await recordTypedWeight(tx, userId, patch.weightKg);

    // RETURNING cannot carry the joined onboarding_completed, so the row is
    // re-read through the one profile select — same tx, so it stays atomic.
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
  onboardingCompleted: boolean;
  // Onboarding v2 (migrations 0026, 0028 and 0030).
  weightGoal: string | null;
  pace: string | null;
  dayActivity: string | null;
  pushUpsMax: number | null;
  plankHoldSeconds: number | null;
  diet: string | null;
  mealsPerDay: number | null;
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
  onboarding_completed: boolean;
  weight_goal: string | null;
  pace: string | null;
  day_activity: string | null;
  push_ups_max: number | null;
  plank_hold_seconds: number | null;
  diet: string | null;
  meals_per_day: number | null;
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
  onboardingCompleted: r.onboarding_completed,
  weightGoal: r.weight_goal,
  pace: r.pace,
  dayActivity: r.day_activity,
  pushUpsMax: r.push_ups_max,
  plankHoldSeconds: r.plank_hold_seconds,
  diet: r.diet,
  mealsPerDay: r.meals_per_day,
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
  "onboarding_completed",
  "weight_goal",
  "pace",
  "day_activity",
  "push_ups_max",
  "plank_hold_seconds",
  "diet",
  "meals_per_day",
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
 *  One transaction, the users row locked first — active-only, as
 *  `patchOnboarding` and `deleteOnboarding` take it and for their reasons, so
 *  the three writers of this row queue on one lock and a concurrent deletion
 *  waits. The FK guarantees the user EXISTS but says nothing about status,
 *  since §5.2 soft-deletes. Null = not active.
 *
 *  `verify` sees the answers as saved, the transaction, and whether setup was
 *  ALREADY finished before this save (read under that lock, so a reset cannot
 *  slip between the read and the write). It throws to refuse the save, and
 *  then nothing of it is written — the service's finish check (4b-ii).
 *
 *  THE ANSWERS ONLY THE SCREENS ASK ARE LEFT ALONE — the pace, the day,
 *  push-ups and plank (0026): this is Settings' route, which has no way to
 *  ask them, so writing NULL over them would throw away an answer this form
 *  never offered. "Full document" means the fields THIS contract carries;
 *  `patchOnboarding` below owns the rest. Screen 1's two questions are among
 *  the fields it carries (4a-iv gave Settings the same two), so a change here
 *  takes effect at once with nothing to keep in step (Kd, 2026-09-11: "it
 *  should automatically update according to change"). */
export async function upsertFitnessProfile(
  sql: Sql,
  userId: string,
  input: FitnessProfileWrite,
  verify?: (saved: OnboardingRow, tx: SqlOrTx, wasCompleted: boolean) => Promise<void> | void,
): Promise<FitnessProfileRow | null> {
  return await sql.begin(async (tx) => {
    const active = await tx<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${userId} AND status = 'active' FOR NO KEY UPDATE`;
    if (active[0] === undefined) return null;
    const before = await tx<{ onboarding_completed: boolean }[]>`
      SELECT onboarding_completed FROM user_fitness_profiles WHERE user_id = ${userId}`;

    const rows = await tx<FitnessProfileDbRow[]>`
      INSERT INTO user_fitness_profiles
        (user_id, age, gender, height_cm, target_weight_kg, fitness_level,
         fitness_goals, weight_goal, exercise_frequency, available_equipment,
         session_duration_min, preferred_workout_time, diet, meals_per_day,
         onboarding_completed, updated_at)
      SELECT u.id, ${input.age}, ${input.gender}, ${input.heightCm},
             ${input.targetWeightKg}, ${input.fitnessLevel}, ${input.fitnessGoals},
             ${input.weightGoal}, ${input.exerciseFrequency}, ${input.availableEquipment},
             ${input.sessionDurationMin}, ${input.preferredWorkoutTime},
             ${input.diet}, ${input.mealsPerDay},
             ${input.onboardingCompleted}, now()
      FROM users u WHERE u.id = ${userId} AND u.status = 'active'
      ON CONFLICT (user_id) DO UPDATE SET
        age = EXCLUDED.age,
        gender = EXCLUDED.gender,
        height_cm = EXCLUDED.height_cm,
        target_weight_kg = EXCLUDED.target_weight_kg,
        fitness_level = EXCLUDED.fitness_level,
        fitness_goals = EXCLUDED.fitness_goals,
        weight_goal = EXCLUDED.weight_goal,
        exercise_frequency = EXCLUDED.exercise_frequency,
        available_equipment = EXCLUDED.available_equipment,
        session_duration_min = EXCLUDED.session_duration_min,
        preferred_workout_time = EXCLUDED.preferred_workout_time,
        diet = EXCLUDED.diet,
        meals_per_day = EXCLUDED.meals_per_day,
        onboarding_completed = EXCLUDED.onboarding_completed,
        updated_at = now()
      RETURNING ${tx(FITNESS_PROFILE_COLUMNS)}`;
    const row = rows[0];
    if (row === undefined) return null;
    // A check that throws here rolls the whole save back.
    await verify?.(await getOnboarding(tx, userId), tx, before[0]?.onboarding_completed === true);
    return toFitnessProfile(row);
  });
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
  weightGoal: string | null;
  exerciseFrequency: number | null;
  availableEquipment: string[];
  sessionDurationMin: number | null;
  preferredWorkoutTime: string | null;
  diet: string | null;
  mealsPerDay: number | null;
  onboardingCompleted: boolean;
}

// ── onboarding v2: save as you go (ROADMAP Stage 1 item 4a) ─────────────────

/** The two rows one screen's answers can touch, read back after the write. */
export interface OnboardingRow {
  /** Null until the person has saved at least one profile answer. */
  profile: FitnessProfileRow | null;
  /** The history's newest weight-bearing row — screen 2 asks it, and it is
   *  saved as a row of that history (RULINGS 2026-09-10). */
  weightKg: number | null;
  /** users.timezone — the fallback for a client that sent none (service). */
  timezone: string | null;
  /** users.display_name — what the app calls the person; screen 2 asks it. */
  displayName: string;
}

/** Reads the answers. Keyed on userId; no status filter for the same reason
 *  `getSyncContext` has none — every caller is behind `authenticate`, so the
 *  account row exists, and its absence fails loud rather than inventing a name. */
export async function getOnboarding(sql: SqlOrTx, userId: string): Promise<OnboardingRow> {
  const profile = await getFitnessProfile(sql, userId);
  const rows = await sql<{ timezone: string | null; display_name: string }[]>`
    SELECT timezone, display_name FROM users WHERE id = ${userId}`;
  const account = rows[0];
  if (account === undefined) throw new Error("getOnboarding: no users row for an authenticated caller");
  return {
    profile,
    weightKg: await currentWeightKg(sql, userId),
    timezone: account.timezone,
    displayName: account.display_name,
  };
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
 *  row is locked first instead, which both proves the account is active and
 *  blocks a concurrent deletion (itself an UPDATE of that row) for the rest of
 *  the transaction. Null = not active.
 *
 *  NO KEY, and that word is load-bearing. Every insert that points at this
 *  person — a meal, a workout, a weigh-in, the health answer — checks its
 *  foreign key with FOR KEY SHARE on the users row, and plain FOR UPDATE is the
 *  one mode that conflicts with it: each of those would wait behind this save,
 *  and one already holding a row this save wants would deadlock (40P01, and a
 *  500 on a save that was perfectly fine). FOR NO KEY UPDATE still excludes
 *  every other writer of this row and the deletion, and lets those checks
 *  through. The v1 upsert above takes the users row the same way, first, so
 *  the two routes queue rather than cross. Pinned by a test that holds exactly
 *  that key-share lock.
 *
 *  `verify` sees the answers as saved, before the commit, and the transaction
 *  they were saved in — so a check can read a row this one does not touch (the
 *  health screening, which finishing setup needs, 4b-i) and still see the same
 *  moment. It throws to refuse the save, and then nothing of it is written. */
export async function patchOnboarding(
  sql: Sql,
  userId: string,
  patch: PatchOnboardingRequest,
  verify?: (saved: OnboardingRow, tx: SqlOrTx) => Promise<void> | void,
): Promise<OnboardingRow | null> {
  return await sql.begin(async (tx) => {
    const active = await tx<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${userId} AND status = 'active' FOR NO KEY UPDATE`;
    if (active[0] === undefined) return null;

    // The name lives on the account row this transaction already holds.
    if (patch.displayName !== undefined) {
      await tx`
        UPDATE users SET display_name = ${patch.displayName}
        WHERE id = ${userId} AND status = 'active'`;
    }

    // Fixed field→column map. `trainingDays` and `sessionMinutes` are the
    // screens' words for columns 0006 already owns — renamed on this surface,
    // never duplicated in the table (migration 0026's note). Screen 1's two
    // answers are two columns, each written only when it is sent, so ticking a
    // goal never touches the weight choice, nor the other way round.
    const cols: Record<string, string | number | boolean | null | string[]> = {};
    if (patch.weightGoal !== undefined) cols["weight_goal"] = patch.weightGoal;
    if (patch.fitnessGoals !== undefined) cols["fitness_goals"] = patch.fitnessGoals;
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
    if (patch.diet !== undefined) cols["diet"] = patch.diet;
    if (patch.mealsPerDay !== undefined) cols["meals_per_day"] = patch.mealsPerDay;
    if (patch.onboardingCompleted !== undefined) cols["onboarding_completed"] = patch.onboardingCompleted;

    if (Object.keys(cols).length > 0) {
      await tx`
        INSERT INTO user_fitness_profiles (user_id) VALUES (${userId})
        ON CONFLICT (user_id) DO NOTHING`;
      await tx`
        UPDATE user_fitness_profiles SET ${tx(cols)}, updated_at = now()
        WHERE user_id = ${userId}`;
    }
    // Screen 2's weight is a row of the history, the only place weight lives
    // (nutrition/repo.ts recordTypedWeight).
    if (patch.weightKg !== undefined) await recordTypedWeight(tx, userId, patch.weightKg);
    const saved = await getOnboarding(tx, userId);
    // A check that throws here rolls the whole save back, so a refused save
    // writes nothing at all.
    await verify?.(saved, tx);
    return saved;
  });
}

/** "Reset onboarding" (RULINGS 2026-07-20: it wipes every answer): the
 *  profile row goes, and every answer on it with it, the ones only the screens
 *  ask included; with no row, the gate reads "not finished".
 *
 *  THE HEALTH ANSWER GOES WITH IT (4b-i), in its own table: the wizard asks the
 *  question again on screen 8, and finishing is refused until it is answered,
 *  so a reset can no longer leave a yes holding the calorie cut with no screen
 *  to answer it on — the reason 4a-iv had to keep it. Both rows go in ONE
 *  transaction, so a reset can never clear one and keep the other.
 *
 *  The consent log is NOT touched: it is append-only proof of a tap that did
 *  happen (RULINGS 2026-09-09, kept six years past deletion), and a reset is
 *  not a claim that the tap never happened.
 *
 *  What is not an answer stays: the name is the account's, and the weight is
 *  the weigh-in history's (RULINGS 2026-09-10).
 *
 *  Active-only, with the users row locked first, as `patchOnboarding` takes it
 *  and for its reasons: a concurrent deletion waits, and NO KEY lets every
 *  foreign-key check on this person through. Null = not active. Deleting a row that
 *  is not there is a quiet success, so a second reset answers as the first. */
export async function deleteOnboarding(sql: Sql, userId: string): Promise<OnboardingRow | null> {
  return await sql.begin(async (tx) => {
    const active = await tx<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${userId} AND status = 'active' FOR NO KEY UPDATE`;
    if (active[0] === undefined) return null;
    await tx`DELETE FROM user_fitness_profiles WHERE user_id = ${userId}`;
    await tx`DELETE FROM user_health_screenings WHERE user_id = ${userId}`;
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
  const rows = await sql<{ timezone: string | null; display_name: string; units: string }[]>`
    SELECT timezone, display_name, units FROM users WHERE id = ${userId}`;
  const r = rows[0];
  return {
    weightKg: await currentWeightKg(sql, userId),
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
