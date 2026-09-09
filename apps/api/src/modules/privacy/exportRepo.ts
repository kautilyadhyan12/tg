// Part 4 §5.2 — the READ side of the privacy module: the user's data export.
// Kept beside repo.ts (the delete side) because §5.2's two rights walk the
// same table list, and a reviewer must be able to check that they agree.
//
// Every statement is literal SQL naming its table — no built identifiers, the
// same rule the delete side follows. Every statement is keyed by the OWNING
// user (R3.2).
//
// THE OWNERSHIP TRAP, inherited from the delete side and mirrored here.
// Three tables cannot be safely read by a `user_id` column:
//   · meal_log_corrections and coach_messages have NO user_id at all;
//   · workout_sets HAS one, but it is a DENORMALISED copy — the Day-14 card's
//     round-3 review proved on Neon that trusting it deletes another user's
//     row (a set can sit in user B's workout while carrying user A's id).
// Read by that column and this endpoint hands one user another user's rows —
// the same bug, pointed the other way. All three therefore join to their
// PARENT and filter on the parent's owner, which is ownership-true by
// construction. The cross-tenant test exists to pin exactly this.
import type { Sql } from "postgres";
import type { ExportedTable } from "./tables.js";

type Row = Record<string, unknown>;

/** The users-row view for the export. ENUMERATED, never `SELECT *` — a
 *  deliberate fail-closed choice (Kd-ruled 2026-07-23): if someone adds a
 *  column to `users` later, this export MISSES it rather than leaking it. A
 *  user missing one field is recoverable; a password hash inside a file they
 *  can download and email around is not. password_hash and hash_algo are
 *  therefore absent by construction, not by filtering, and legacy_mongo_id is
 *  omitted as an internal migration id that means nothing to the user. */
export async function selectExportUser(sql: Sql, userId: string): Promise<Row | null> {
  const rows = await sql<Row[]>`
    SELECT id, email, display_name, locale, units, timezone, weight_kg,
           leaderboard_opt_out, status, last_active_at, created_at
    FROM users
    WHERE id = ${userId}`;
  return rows[0] ?? null;
}

/** One reader per exported table, keyed by the table's real name so the
 *  export's `data` keys and this map cannot drift. `SELECT *` is correct for
 *  these — they hold the user's own content and the export exists to be
 *  COMPLETE, so a column added later should flow to them automatically.
 *  (`users` and `auth_identities` are the two that enumerate instead; see
 *  above and below.) Ordered by a stable key so repeat exports are diffable.
 *
 *  NB `runs.polyline` / `saved_routes.polyline` ARE included: Part 4 §3.9
 *  says GPS polylines are "excluded from all exports except the user's own
 *  DPDP export" — this is that export, and they are the user's own route. */
export const EXPORT_READERS: Record<ExportedTable, (sql: Sql, userId: string) => Promise<Row[]>> = {
  meal_logs: (sql, u) =>
    sql<Row[]>`SELECT * FROM meal_logs WHERE user_id = ${u} ORDER BY taken_at, id`,

  // No user_id — owned through its meal.
  meal_log_corrections: (sql, u) => sql<Row[]>`
    SELECT c.* FROM meal_log_corrections c
    JOIN meal_logs m ON m.id = c.meal_log_id
    WHERE m.user_id = ${u}
    ORDER BY c.created_at, c.id`,

  user_dishware: (sql, u) =>
    sql<Row[]>`SELECT * FROM user_dishware WHERE user_id = ${u} ORDER BY created_at, id`,

  coach_threads: (sql, u) =>
    sql<Row[]>`SELECT * FROM coach_threads WHERE user_id = ${u} ORDER BY created_at, id`,

  // No user_id — owned through its thread.
  coach_messages: (sql, u) => sql<Row[]>`
    SELECT m.* FROM coach_messages m
    JOIN coach_threads t ON t.id = m.thread_id
    WHERE t.user_id = ${u}
    ORDER BY m.created_at, m.id`,

  runs: (sql, u) => sql<Row[]>`SELECT * FROM runs WHERE user_id = ${u} ORDER BY started_at, id`,

  saved_routes: (sql, u) =>
    sql<Row[]>`SELECT * FROM saved_routes WHERE user_id = ${u} ORDER BY created_at, id`,

  run_schedules: (sql, u) =>
    sql<Row[]>`SELECT * FROM run_schedules WHERE user_id = ${u} ORDER BY created_at, id`,

  body_measurements: (sql, u) =>
    sql<Row[]>`SELECT * FROM body_measurements WHERE user_id = ${u} ORDER BY measured_at, id`,

  workout_templates: (sql, u) =>
    sql<Row[]>`SELECT * FROM workout_templates WHERE user_id = ${u} ORDER BY created_at, id`,

  workouts: (sql, u) =>
    sql<Row[]>`SELECT * FROM workouts WHERE user_id = ${u} ORDER BY started_at, id`,

  // HAS a user_id, deliberately NOT used — see the ownership trap above.
  workout_sets: (sql, u) => sql<Row[]>`
    SELECT s.* FROM workout_sets s
    JOIN workouts w ON w.id = s.workout_id
    WHERE w.user_id = ${u}
    ORDER BY s.started_at, s.set_index, s.id`,

  user_achievements: (sql, u) =>
    sql<Row[]>`SELECT * FROM user_achievements WHERE user_id = ${u} ORDER BY code`,

  streaks: (sql, u) => sql<Row[]>`SELECT * FROM streaks WHERE user_id = ${u}`,

  // The user's own lifetime XP — their own game score, SELECT * like streaks.
  user_xp: (sql, u) => sql<Row[]>`SELECT * FROM user_xp WHERE user_id = ${u}`,

  challenge_participants: (sql, u) =>
    sql<Row[]>`SELECT * FROM challenge_participants WHERE user_id = ${u} ORDER BY challenge_id`,

  // ENUMERATED, not SELECT *: this is the one exported table that is
  // credential-ADJACENT. `provider` + `subject` say "this Google account is
  // linked", which is the user's own identity data and belongs in an export;
  // enumerating means a future token/secret column here cannot join it.
  auth_identities: (sql, u) => sql<Row[]>`
    SELECT id, user_id, provider, subject, created_at
    FROM auth_identities WHERE user_id = ${u} ORDER BY provider, id`,

  user_fitness_profiles: (sql, u) =>
    sql<Row[]>`SELECT * FROM user_fitness_profiles WHERE user_id = ${u}`,

  user_health_screenings: (sql, u) =>
    sql<Row[]>`SELECT * FROM user_health_screenings WHERE user_id = ${u}`,
};

/** The most consent rows one export carries. Thirty taps an hour is the route's
 *  ceiling (users/routes.ts), so an honest account never gets near this; it
 *  exists so a runaway client cannot turn the export — which holds the
 *  process's only connection (export.ts) — into an unbounded read. */
export const CONSENT_EXPORT_LIMIT = 1000;

/** The consent log is NOT on the Day-14 delete list (tables.ts: kept as proof
 *  for six years, like audit_log) but it IS the person's own record of what they agreed to, so the
 *  export carries it beside the PII tables. Read here, keyed on the owner.
 *
 *  It is not an ExportedTable, so `stripInternal` never sees it and no
 *  INTERNAL_COLUMNS_BY_TABLE entry can ever cover it: THE EXPLICIT COLUMN LIST
 *  BELOW IS THE GUARD. Never widen it to `SELECT *`.
 *
 *  The TOTAL comes back beside the rows, exactly as the list route's read does
 *  (users/repo.ts listConsents): the cap above must never let a short file pass
 *  for the whole record — an export that quietly drops rows is the one place
 *  where "here is your data" would be false. `export.ts` says so in the file. */
export async function selectExportConsents(
  sql: Sql,
  userId: string,
): Promise<{ rows: Row[]; total: number }> {
  const rows = await sql<Row[]>`
    SELECT id, purpose, wording_version, wording, app_version, recorded_at
    FROM consent_log WHERE user_id = ${userId}
    ORDER BY recorded_at, id
    LIMIT ${CONSENT_EXPORT_LIMIT}`;
  const counted = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM consent_log WHERE user_id = ${userId}`;
  // Never below what was actually read: a total under the row count would make
  // the envelope's own "listed ≤ total" claim false.
  return { rows, total: Math.max(counted[0]?.n ?? 0, rows.length) };
}
