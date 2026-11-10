// P2.6b — geo repo: the ONLY file that touches runs / saved_routes / geo_cache
// (v1 §6.2, R4.6). Every tenant query is keyed by the owning userId (R3.2) —
// runs/saved_routes hold GPS polylines, the most sensitive data the app holds
// (Part 4 §3.9): own-user-only, never fetched by id alone. api_cost_events and
// the gym_members spend-time lookup are metering/tenancy tables with no owning
// module; written here like the nutrition/coach tasks' disclosed crossings
// (getLiveGymId duplicated from nutrition/repo.ts — a cross-module repo import
// would violate R7.1).
import type { RunBests, RunClimb, RunPlanAnswers, RunRecordKind } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { ORS_ROUTE_COST_MICRO } from "./cost.js";

export interface RunRow {
  id: string;
  startedAt: Date;
  durationS: number;
  distanceM: number;
  routeName: string | null;
  kcalPoint: number | null;
  source: string;
  polyline: string | null;
  // ROADMAP 37c-i.
  name: string | null;
  elapsedS: number | null;
  climbM: number | null;
  shape: string | null;
  /** The day it began in the person's own time zone, YYYY-MM-DD. */
  day: string;
  /** What the shape is made from while it has none yet: the saved line and its splits' starts. */
  shapeFrom: { polyline: string; splits: unknown } | null;
  /** Brought over from the old app (`tools/migrate-mongo`): its line is that app's JSON path, not a coded line. */
  legacy: boolean;
}

/** A run's own page: the summary's row and what its page shows besides. */
export interface RunDetailRow extends RunRow {
  splits: unknown;
  effort: number | null;
  note: string | null;
  leftOutM: number | null;
  leftOutS: number | null;
  bests: RunBests;
}

export interface SavedRouteRow {
  id: string;
  name: string;
  polyline: string;
  distanceM: number;
  createdAt: Date;
}

interface RunDbRow {
  id: string;
  started_at: Date;
  duration_s: number;
  distance_m: number;
  route_name: string | null;
  kcal_point: number | null;
  source: string;
  polyline: string | null;
  name: string | null;
  elapsed_s: number | null;
  climb_m: number | null;
  shape: string | null;
  day: string;
  shape_polyline: string | null;
  shape_splits: unknown;
  legacy: boolean;
}

interface RunDetailDbRow extends RunDbRow {
  splits: unknown;
  effort: number | null;
  note: string | null;
  left_out_m: number | null;
  left_out_s: number | null;
  best_1k_s: number | null;
  best_mile_s: number | null;
  best_5k_s: number | null;
  best_10k_s: number | null;
}

interface SavedRouteDbRow {
  id: string;
  name: string;
  polyline: string;
  distance_m: number;
  created_at: Date;
}

const toRun = (r: RunDbRow): RunRow => ({
  id: r.id,
  startedAt: r.started_at,
  durationS: r.duration_s,
  distanceM: r.distance_m,
  routeName: r.route_name,
  kcalPoint: r.kcal_point,
  source: r.source,
  polyline: r.polyline,
  name: r.name,
  elapsedS: r.elapsed_s,
  climbM: r.climb_m,
  shape: r.shape,
  day: r.day,
  shapeFrom: r.shape === null && r.shape_polyline !== null ? { polyline: r.shape_polyline, splits: r.shape_splits } : null,
  legacy: r.legacy,
});

const toRunDetail = (r: RunDetailDbRow): RunDetailRow => ({
  ...toRun(r),
  splits: r.splits,
  effort: r.effort,
  note: r.note,
  leftOutM: r.left_out_m,
  leftOutS: r.left_out_s,
  bests: { k1: r.best_1k_s, mile: r.best_mile_s, k5: r.best_5k_s, k10: r.best_10k_s },
});

const toSavedRoute = (r: SavedRouteDbRow): SavedRouteRow => ({
  id: r.id,
  name: r.name,
  polyline: r.polyline,
  distanceM: r.distance_m,
  createdAt: r.created_at,
});

// ── runs (read-only; record/sync = P5) ──────────────────────────────────────

/** A page of the person's runs, newest first, from the cursor, or from the end of the day `upTo` of
 *  their own time zone (`timeZone`, a safeTimeZone-validated IANA name, always a parameterized value). */
export async function listRuns(
  sql: Sql,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
  timeZone: string,
  upTo: string | null = null,
): Promise<RunRow[]> {
  // Summary read: the saved line is never sent, only read here to make a shape for a run that has none
  // yet (saved before 37c-i), once.
  const rows = await sql<RunDbRow[]>`
    SELECT id, started_at, duration_s, distance_m, route_name, kcal_point, source, NULL AS polyline,
           name, elapsed_s, climb_m, shape, to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
           CASE WHEN shape IS NULL THEN polyline END AS shape_polyline,
           CASE WHEN shape IS NULL THEN splits END AS shape_splits,
           legacy_mongo_id IS NOT NULL AS legacy
    FROM runs
    WHERE user_id = ${userId}
      AND (${cursor === null} OR (started_at, id) < (${cursor?.at ?? null}, ${cursor?.id ?? null}))
      AND (${upTo === null} OR started_at < ((${upTo}::date + 1)::timestamp AT TIME ZONE ${timeZone}))
    ORDER BY started_at DESC, id DESC
    LIMIT ${limit + 1}`;
  return rows.map(toRun);
}

/** Every run the person has, counted, and its metres. */
export async function getRunCount(sql: Sql, userId: string): Promise<{ runs: number; distanceM: number }> {
  const [r] = await sql<{ n: string; m: string }[]>`
    SELECT count(*) AS n, coalesce(sum(distance_m), 0) AS m FROM runs WHERE user_id = ${userId}`;
  return { runs: Number(r?.n ?? 0), distanceM: Number(r?.m ?? 0) };
}

/** Each named month's runs and metres, whole, in the person's own time zone (YYYY-MM). */
export async function getRunMonths(sql: Sql, userId: string, timeZone: string, months: readonly string[]): Promise<{ month: string; runs: number; distanceM: number }[]> {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const from = `${sorted[0] ?? ""}-01`;
  const to = `${sorted[sorted.length - 1] ?? ""}-01`;
  const rows = await sql<{ month: string; n: string; m: string }[]>`
    SELECT to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM') AS month, count(*) AS n, coalesce(sum(distance_m), 0) AS m
    FROM runs
    WHERE user_id = ${userId}
      AND started_at >= (${from}::date::timestamp AT TIME ZONE ${timeZone})
      AND started_at < ((${to}::date + interval '1 month')::timestamp AT TIME ZONE ${timeZone})
    GROUP BY month`;
  const wanted = new Set(months);
  return rows.filter((r) => wanted.has(r.month)).map((r) => ({ month: r.month, runs: Number(r.n), distanceM: Number(r.m) }));
}

/** The days of one month the person ran, in their own time zone, with each day's runs and metres. */
export async function getRunCalendar(sql: Sql, userId: string, timeZone: string, month: string): Promise<{ day: string; runs: number; distanceM: number }[]> {
  const first = `${month}-01`;
  const rows = await sql<{ day: string; n: string; m: string }[]>`
    SELECT to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, count(*) AS n, coalesce(sum(distance_m), 0) AS m
    FROM runs
    WHERE user_id = ${userId}
      AND started_at >= (${first}::date::timestamp AT TIME ZONE ${timeZone})
      AND started_at < ((${first}::date + interval '1 month')::timestamp AT TIME ZONE ${timeZone})
    GROUP BY day ORDER BY day`;
  return rows.map((r) => ({ day: r.day, runs: Number(r.n), distanceM: Number(r.m) }));
}

/** The day of the person's first run, in their own time zone; null with none. */
export async function getFirstRunDay(sql: Sql, userId: string, timeZone: string): Promise<string | null> {
  const [r] = await sql<{ day: string | null }[]>`
    SELECT to_char(min(started_at) AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day FROM runs WHERE user_id = ${userId}`;
  return r?.day ?? null;
}

/** A run's shape, kept the first time the list makes it; never over one already kept. */
export async function keepRunShape(sql: Sql, userId: string, id: string, shape: string): Promise<void> {
  await sql`UPDATE runs SET shape = ${shape} WHERE id = ${id} AND user_id = ${userId} AND shape IS NULL`;
}

/** Progress's numbers (ROADMAP 31a): the person's runs since `since`, counted and summed. */
export async function getRunTotals(
  sql: Sql,
  userId: string,
  since: Date | null,
): Promise<{ count: number; durationMs: number; kcal: number }> {
  const [r] = await sql<{ n: string; dur: string; kcal: string }[]>`
    SELECT count(*) AS n, coalesce(sum(duration_s), 0) AS dur, coalesce(sum(kcal_point), 0) AS kcal
    FROM runs
    WHERE user_id = ${userId} AND (${since === null} OR started_at >= ${since})`;
  return { count: Number(r?.n ?? 0), durationMs: Number(r?.dur ?? 0) * 1000, kcal: Number(r?.kcal ?? 0) };
}

/** The days with a run since `since`, in the person's own time zone (a safeTimeZone-validated IANA
 *  name, always a parameterized value), oldest first. */
export async function getRunDays(
  sql: Sql,
  userId: string,
  since: Date | null,
  timeZone: string,
): Promise<{ date: string; runs: number }[]> {
  const rows = await sql<{ day: string; n: string }[]>`
    SELECT to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, count(*) AS n
    FROM runs
    WHERE user_id = ${userId} AND (${since === null} OR started_at >= ${since})
    GROUP BY day ORDER BY day ASC`;
  return rows.map((r) => ({ date: r.day, runs: Number(r.n) }));
}

const runDetailColumns = (sql: Sql, timeZone: string) => sql`
  id, started_at, duration_s, distance_m, route_name, kcal_point, source, polyline, name, elapsed_s, climb_m, shape,
  to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
  CASE WHEN shape IS NULL THEN polyline END AS shape_polyline, CASE WHEN shape IS NULL THEN splits END AS shape_splits,
  splits, effort, note, left_out_m, left_out_s, legacy_mongo_id IS NOT NULL AS legacy,
  best_1k_s, best_mile_s, best_5k_s, best_10k_s`;

export async function getRun(sql: Sql, userId: string, id: string, timeZone: string): Promise<RunDetailRow | null> {
  const rows = await sql<RunDetailDbRow[]>`
    SELECT ${runDetailColumns(sql, timeZone)}
    FROM runs
    WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] === undefined ? null : toRunDetail(rows[0]);
}

/** What the person changes of their own run: each field given, the others as they are. Null when they
 *  have no run by this id. */
export async function changeRun(
  sql: Sql,
  userId: string,
  id: string,
  change: { name?: string | undefined; effort?: number | null | undefined; note?: string | null | undefined },
  timeZone: string,
): Promise<RunDetailRow | null> {
  const rows = await sql<RunDetailDbRow[]>`
    UPDATE runs SET
      name = CASE WHEN ${change.name !== undefined} THEN ${change.name ?? null}::text ELSE name END,
      effort = CASE WHEN ${change.effort !== undefined} THEN ${change.effort ?? null}::smallint ELSE effort END,
      note = CASE WHEN ${change.note !== undefined} THEN ${change.note ?? null}::text ELSE note END
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING ${runDetailColumns(sql, timeZone)}`;
  return rows[0] === undefined ? null : toRunDetail(rows[0]);
}

const lockRunId = async (tx: TransactionSql, id: string): Promise<void> => {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`run:${id}`}))`;
};

/** Deletes the person's run, its route with it, and keeps its id for them under the lock a save of that
 *  id takes, so a save of it still on its way keeps nothing (`insertRun`). False: none of theirs by it. */
export async function removeRun(sql: Sql, userId: string, id: string): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockRunId(tx, id);
    const rows = await tx<{ id: string }[]>`DELETE FROM runs WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    if (rows.length === 0) return false;
    await tx`INSERT INTO run_removed_ids (id, user_id) VALUES (${id}, ${userId}) ON CONFLICT (id) DO NOTHING`;
    return true;
  });
}

/** Whether this person deleted a run by this id. */
export async function wasRunRemoved(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM run_removed_ids WHERE id = ${id} AND user_id = ${userId}`;
  return rows.length > 0;
}

// ── Running records (ROADMAP 37c-ii) ─────────────────────────────────────────────────────────────

/** Runs from this long count for the longest run: the streak's and XP's own line. */
export const LONGEST_RUN_FROM_M = 200;

export interface RunRecordRow {
  kind: RunRecordKind;
  runId: string;
  name: string | null;
  startedAt: Date;
  day: string;
  value: number;
  before: number | null;
}

/** The person's records, from their own runs that this app recorded (`run_calc_version`, as XP
 *  counts them): each distance's fastest time, the longest run from LONGEST_RUN_FROM_M, a tie held by
 *  the run that set it first; and the best before that run, from the runs begun earlier. */
export async function getRunRecords(sql: Sql, userId: string, timeZone: string): Promise<RunRecordRow[]> {
  const rows = await sql<{ kind: RunRecordKind; id: string; name: string | null; started_at: Date; day: string; value: number; before: number | null }[]>`
    WITH mine AS (
      SELECT id, name, started_at, distance_m, best_1k_s, best_mile_s, best_5k_s, best_10k_s,
             to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day
      FROM runs WHERE user_id = ${userId} AND run_calc_version IS NOT NULL
    ), fastest AS (
      SELECT m.id, m.name, m.started_at, m.day, k.kind,
             CASE k.kind WHEN 'k1' THEN m.best_1k_s WHEN 'mile' THEN m.best_mile_s
                         WHEN 'k5' THEN m.best_5k_s ELSE m.best_10k_s END AS value
      FROM mine m CROSS JOIN (VALUES ('k1'), ('mile'), ('k5'), ('k10')) AS k(kind)
    ), held AS (
      SELECT DISTINCT ON (kind) * FROM fastest WHERE value IS NOT NULL ORDER BY kind, value, started_at, id
    ), longest AS (
      SELECT id, name, started_at, day, distance_m AS value FROM mine
      WHERE distance_m >= ${LONGEST_RUN_FROM_M} ORDER BY distance_m DESC, started_at, id LIMIT 1
    )
    SELECT h.kind, h.id, h.name, h.started_at, h.day, h.value,
           (SELECT min(f.value) FROM fastest f
            WHERE f.kind = h.kind AND f.value IS NOT NULL AND (f.started_at, f.id) < (h.started_at, h.id)) AS before
    FROM held h
    UNION ALL
    SELECT 'longest', l.id, l.name, l.started_at, l.day, l.value,
           (SELECT max(m.distance_m) FROM mine m
            WHERE m.distance_m >= ${LONGEST_RUN_FROM_M} AND (m.started_at, m.id) < (l.started_at, l.id)) AS before
    FROM longest l`;
  return rows.map((r) => ({ kind: r.kind, runId: r.id, name: r.name, startedAt: r.started_at, day: r.day, value: r.value, before: r.before }));
}

// ── saved_routes CRUD ────────────────────────────────────────────────────────

export async function createSavedRoute(
  sql: Sql,
  userId: string,
  input: { name: string; polyline: string; distanceM: number },
): Promise<SavedRouteRow> {
  const rows = await sql<SavedRouteDbRow[]>`
    INSERT INTO saved_routes (user_id, name, polyline, distance_m)
    VALUES (${userId}, ${input.name}, ${input.polyline}, ${input.distanceM})
    RETURNING id, name, polyline, distance_m, created_at`;
  const row = rows[0];
  if (row === undefined) throw new Error("saved_route insert returned no row");
  return toSavedRoute(row);
}

export async function listSavedRoutes(
  sql: Sql,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<SavedRouteRow[]> {
  const rows = await sql<SavedRouteDbRow[]>`
    SELECT id, name, polyline, distance_m, created_at
    FROM saved_routes
    WHERE user_id = ${userId}
      AND (${cursor === null} OR (created_at, id) < (${cursor?.at ?? null}, ${cursor?.id ?? null}))
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}`;
  return rows.map(toSavedRoute);
}

export async function getSavedRoute(sql: Sql, userId: string, id: string): Promise<SavedRouteRow | null> {
  const rows = await sql<SavedRouteDbRow[]>`
    SELECT id, name, polyline, distance_m, created_at
    FROM saved_routes
    WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] === undefined ? null : toSavedRoute(rows[0]);
}

export async function deleteSavedRoute(sql: Sql, userId: string, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM saved_routes WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

// ── geo_cache (persistent floor under the Redis geocode cache) ───────────────

export async function geoCacheGet(
  sql: Sql,
  lat3: number,
  lng3: number,
): Promise<{ name: string; provider: string } | null> {
  const rows = await sql<{ name: string; provider: string }[]>`
    SELECT name, provider FROM geo_cache WHERE lat3 = ${lat3} AND lng3 = ${lng3}`;
  return rows[0] ?? null;
}

export async function geoCacheUpsert(
  sql: Sql,
  lat3: number,
  lng3: number,
  name: string,
  provider: string,
): Promise<void> {
  await sql`
    INSERT INTO geo_cache (lat3, lng3, name, provider, cached_at)
    VALUES (${lat3}, ${lng3}, ${name}, ${provider}, now())
    ON CONFLICT (lat3, lng3) DO UPDATE
      SET name = EXCLUDED.name, provider = EXCLUDED.provider, cached_at = now()`;
}

// ── metering (v1 §9.3: every external API call writes an api_cost_events row) ─

/** One ledger row per successful ORS call. cost_micro travels as text→::bigint
 *  (postgres.js doesn't parameterize JS bigint); units=1, ORS free/OSM tier has
 *  no per-call price so cost_micro=0 (the row is the CALL-COUNT requirement, not
 *  a dollar charge — DECISIONS 2026-07-13). */
export async function insertRouteGenCostEvent(
  sql: Sql,
  input: { userId: string; gymId: string | null },
): Promise<void> {
  await sql`
    INSERT INTO api_cost_events (user_id, gym_id, feature, provider, units, unit_type, cost_micro)
    VALUES (${input.userId}, ${input.gymId}, 'route_gen', 'ors', 1, 'route',
            ${ORS_ROUTE_COST_MICRO.toString()}::bigint)`;
}

/** Live gym at spend time (§3.10: null for direct consumers). Duplicated from
 *  nutrition/repo.ts — module-local by R7.1. */
export async function getLiveGymId(sql: Sql, userId: string): Promise<string | null> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT m.gym_id FROM gym_members m
    JOIN subscriptions s ON s.owner_type = 'gym' AND s.owner_id = m.gym_id
                         AND s.status IN ('trialing','active','past_due')
    WHERE m.user_id = ${userId} AND m.removed_at IS NULL
    LIMIT 1`;
  return rows[0]?.gym_id ?? null;
}

// ── Record a run (ROADMAP 37a) ─────────────────────────────────────────────────────────────────

/** The run's id is already another person's: refused as if it were not there. */
export class ForeignRunError extends Error {
  constructor() {
    super("run does not belong to the authenticated user");
    this.name = "ForeignRunError";
  }
}

export interface NewRun {
  id: string;
  startedAt: Date;
  name: string;
  effort: number | null;
  note: string | null;
  distanceM: number;
  movingS: number;
  elapsedS: number;
  leftOutM: number;
  leftOutS: number;
  kcal: number;
  splits: { km: { m: number; s: number }[]; mi: { m: number; s: number }[]; starts: number[]; pace: number[]; hills: number[] };
  polyline: string;
  calcVersion: number;
  climb: RunClimb;
  /** The route made small for Your runs (37c-i); null with no route. */
  shape: string | null;
  /** Its fastest 1 km, mile, 5 km and 10 km (37c-ii). */
  bests: RunBests;
}

export interface SavedRunRow {
  id: string;
  startedAt: Date;
  name: string | null;
  effort: number | null;
  note: string | null;
  distanceM: number;
  movingS: number;
  elapsedS: number | null;
  leftOutM: number | null;
  leftOutS: number | null;
  kcal: number | null;
  splits: unknown;
  polyline: string | null;
  climbM: number | null;
}

interface SavedRunDbRow {
  id: string;
  started_at: Date;
  name: string | null;
  effort: number | null;
  note: string | null;
  distance_m: number;
  duration_s: number;
  elapsed_s: number | null;
  left_out_m: number | null;
  left_out_s: number | null;
  kcal_point: number | null;
  splits: unknown;
  polyline: string | null;
  climb_m: number | null;
}

const toSavedRun = (r: SavedRunDbRow): SavedRunRow => ({
  id: r.id,
  startedAt: r.started_at,
  name: r.name,
  effort: r.effort,
  note: r.note,
  distanceM: r.distance_m,
  movingS: r.duration_s,
  elapsedS: r.elapsed_s,
  leftOutM: r.left_out_m,
  leftOutS: r.left_out_s,
  kcal: r.kcal_point,
  splits: r.splits,
  polyline: r.polyline,
  climbM: r.climb_m,
});

/** Saves a run once: a second send of the same id changes nothing and reads back what the first
 *  saved. Whose it is is checked on the row as it stands after the insert, so two people's first
 *  sends of one id can never both pass. */
export async function insertRun(sql: Sql, userId: string, run: NewRun): Promise<{ created: boolean; row: SavedRunRow } | "removed"> {
  return await sql.begin(async (tx) => {
    await lockRunId(tx, run.id);
    // Deleted while its send was on its way: kept nothing (37c-i). Another person's deleted id is refused as it
    // was while their run stood (404), so a stranger learns nothing and no run ever shares a deleted id.
    const removed = await tx<{ user_id: string }[]>`SELECT user_id FROM run_removed_ids WHERE id = ${run.id}`;
    if (removed[0] !== undefined) {
      if (removed[0].user_id !== userId) throw new ForeignRunError();
      return "removed" as const;
    }
    const inserted = await tx`
      INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, polyline, splits, kcal_point,
                        kcal_calc_version, source, name, effort, note, elapsed_s, left_out_m, left_out_s,
                        run_calc_version, climb_m, climb_state, shape, best_1k_s, best_mile_s, best_5k_s, best_10k_s)
      VALUES (${run.id}, ${userId}, ${run.startedAt}, ${run.movingS}, ${run.distanceM}, ${run.polyline},
              ${tx.json(run.splits)}, ${run.kcal}, ${run.calcVersion}, 'mobile', ${run.name}, ${run.effort},
              ${run.note}, ${run.elapsedS}, ${run.leftOutM}, ${run.leftOutS}, ${run.calcVersion},
              ${run.climb.state === "done" ? run.climb.m : null}, ${run.climb.state}, ${run.shape},
              ${run.bests.k1}, ${run.bests.mile}, ${run.bests.k5}, ${run.bests.k10})
      ON CONFLICT (id) DO NOTHING`;
    const rows = await tx<(SavedRunDbRow & { user_id: string })[]>`
      SELECT id, user_id, started_at, name, effort, note, distance_m, duration_s, elapsed_s, left_out_m,
             left_out_s, kcal_point, splits, polyline, climb_m
      FROM runs WHERE id = ${run.id}`;
    const row = rows[0];
    if (row === undefined || row.user_id !== userId) throw new ForeignRunError();
    return { created: inserted.count === 1, row: toSavedRun(row) };
  });
}

/** A run of this person's by its id, as saved; null when they have none by it. */
export async function getSavedRun(sql: Sql, userId: string, id: string): Promise<SavedRunRow | null> {
  const rows = await sql<SavedRunDbRow[]>`
    SELECT id, started_at, name, effort, note, distance_m, duration_s, elapsed_s, left_out_m, left_out_s,
           kcal_point, splits, polyline, climb_m
    FROM runs WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] === undefined ? null : toSavedRun(rows[0]);
}

// ── A run's elevation gain, worked out again later (ROADMAP 37b-ii) ──────────────────────────────

export interface WaitingClimb {
  id: string;
  userId: string;
  polyline: string | null;
  splits: unknown;
}

/** Runs whose elevation gain waits for a piece of the height map, the newest first: one that never
 *  stops waiting can hold up none saved after it (round one of 37b-ii, L3). */
export async function listWaitingClimbs(sql: Sql, limit: number): Promise<WaitingClimb[]> {
  const rows = await sql<{ id: string; user_id: string; polyline: string | null; splits: unknown }[]>`
    SELECT id, user_id, polyline, splits FROM runs
    WHERE climb_state = 'waiting'
    ORDER BY created_at DESC, id
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, userId: r.user_id, polyline: r.polyline, splits: r.splits }));
}

/** Runs still waiting this many days after they were saved have no number: their map never came. */
export async function giveUpOldClimbs(sql: Sql, days: number): Promise<number> {
  const done = await sql`
    UPDATE runs SET climb_state = 'none'
    WHERE climb_state = 'waiting' AND created_at < now() - ${days} * interval '1 day'`;
  return done.count;
}

/** Keeps a run's elevation gain once it is known, only while it still waits: a second worker, or the
 *  same one twice, changes nothing. True when this call kept it. */
export async function keepWaitingClimb(sql: Sql, run: { id: string; userId: string }, climb: Exclude<RunClimb, { state: "waiting" }>): Promise<boolean> {
  const done = await sql`
    UPDATE runs SET climb_m = ${climb.state === "done" ? climb.m : null}, climb_state = ${climb.state},
      splits = CASE WHEN jsonb_typeof(splits) = 'object'
                    THEN splits || jsonb_build_object('hills', ${sql.json(climb.state === "done" ? climb.hills : [])}::jsonb)
                    ELSE splits END
    WHERE id = ${run.id} AND user_id = ${run.userId} AND climb_state = 'waiting'`;
  return done.count === 1;
}

// ── The run plan (ROADMAP 37d-i) ──────────────────────────────────────────────────────────────

export interface RunPlanRow {
  answers: unknown;
  answeredAt: Date;
}

/** The person's own answers, by their own id only. */
export async function getRunPlan(sql: Sql, userId: string): Promise<RunPlanRow | null> {
  const rows = await sql<{ answers: unknown; answered_at: Date }[]>`
    SELECT answers, answered_at FROM run_plans WHERE user_id = ${userId}`;
  const row = rows[0];
  return row === undefined ? null : { answers: row.answers, answeredAt: row.answered_at };
}

/** New answers make the plan again from today: one statement, so two at once leave the newer. */
export async function putRunPlan(sql: Sql, userId: string, answers: RunPlanAnswers, at: Date): Promise<void> {
  await sql`
    INSERT INTO run_plans (user_id, answers, answered_at, updated_at)
    VALUES (${userId}, ${sql.json(answers)}, ${at}, ${at})
    ON CONFLICT (user_id) DO UPDATE SET answers = EXCLUDED.answers, answered_at = EXCLUDED.answered_at, updated_at = EXCLUDED.updated_at`;
}

/** One row a day of the person's runs that this app recorded (as XP and the records count them), in
 *  their own time zone, from `fromDay`: the day's distance, its longest run and its longest moving time. */
export async function getRunPlanDays(sql: Sql, userId: string, timeZone: string, fromDay: string): Promise<{ day: string; distanceM: number; longestM: number; movingS: number }[]> {
  const rows = await sql<{ day: string; m: string; longest: number; moving: number }[]>`
    SELECT to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
           sum(distance_m) AS m, max(distance_m) AS longest, max(duration_s) AS moving
    FROM runs
    WHERE user_id = ${userId} AND run_calc_version IS NOT NULL
      AND started_at >= (${fromDay}::date::timestamp AT TIME ZONE ${timeZone})
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, distanceM: Number(r.m), longestM: r.longest, movingS: r.moving }));
}
