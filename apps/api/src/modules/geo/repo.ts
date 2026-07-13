// P2.6b — geo repo: the ONLY file that touches runs / saved_routes / geo_cache
// (v1 §6.2, R4.6). Every tenant query is keyed by the owning userId (R3.2) —
// runs/saved_routes hold GPS polylines, the most sensitive data the app holds
// (Part 4 §3.9): own-user-only, never fetched by id alone. api_cost_events and
// the gym_members spend-time lookup are metering/tenancy tables with no owning
// module; written here like the nutrition/coach tasks' disclosed crossings
// (getLiveGymId duplicated from nutrition/repo.ts — a cross-module repo import
// would violate R7.1).
import type { Sql } from "postgres";
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
});

const toSavedRoute = (r: SavedRouteDbRow): SavedRouteRow => ({
  id: r.id,
  name: r.name,
  polyline: r.polyline,
  distanceM: r.distance_m,
  createdAt: r.created_at,
});

// ── runs (read-only; record/sync = P5) ──────────────────────────────────────

export async function listRuns(
  sql: Sql,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<RunRow[]> {
  // Summary read — polyline deliberately excluded (sensitive; detail-only).
  const rows = await sql<RunDbRow[]>`
    SELECT id, started_at, duration_s, distance_m, route_name, kcal_point, source, NULL AS polyline
    FROM runs
    WHERE user_id = ${userId}
      AND (${cursor === null} OR (started_at, id) < (${cursor?.at ?? null}, ${cursor?.id ?? null}))
    ORDER BY started_at DESC, id DESC
    LIMIT ${limit + 1}`;
  return rows.map(toRun);
}

export async function getRun(sql: Sql, userId: string, id: string): Promise<RunRow | null> {
  const rows = await sql<RunDbRow[]>`
    SELECT id, started_at, duration_s, distance_m, route_name, kcal_point, source, polyline
    FROM runs
    WHERE id = ${id} AND user_id = ${userId}`;
  return rows[0] === undefined ? null : toRun(rows[0]);
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
