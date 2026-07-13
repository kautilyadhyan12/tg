// P2.6b — geo service: route generation orchestration + saved_routes/runs read
// seams. Route generation is fail-closed (v1 §9.3): no ORS key or an ORS blip →
// typed 503, NEVER a mock fallback (the salvage's mock generator is
// deliberately not ported — DECISIONS 2026-07-13). Scoring + weather are
// deferred to @app/engine / P5 (v1 §12); this returns normalized ORS
// candidates only.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import type { GenerateRoutesRequest, RouteCandidate, SavedRoute, SavedRouteCreate, RunDetail, RunSummary } from "@app/shared";
import { GeoError } from "./errors.js";
import type { RouteProvider } from "./ors.adapter.js";
import * as repo from "./repo.js";

export interface GeoDeps {
  sql: Sql;
  /** null = ORS_API_KEY unset → route generation 503s cleanly (fail-closed). */
  routeProvider: RouteProvider | null;
  log: FastifyBaseLogger;
}
type ReadDeps = Pick<GeoDeps, "sql">;

// Per-request seeds ported verbatim from routing_provider.py:239 — reproducible
// distinct candidates within one request.
const routeSeeds = (count: number): number[] => Array.from({ length: count }, (_, i) => 11 + i * 37);

/** One api_cost_events row per SUCCESSFUL ORS call (v1 §9.3; CORRECTION 2). A
 *  network/parse failure returns no completion → no row, matching the P2.6a
 *  vision ledger ruling (DECISIONS 2026-07-12). getLiveGymId + insert run as
 *  two statements — same accepted residual class (outbox owed with billing). */
async function routeLedger(deps: GeoDeps, userId: string): Promise<void> {
  await repo.insertRouteGenCostEvent(deps.sql, {
    userId,
    gymId: await repo.getLiveGymId(deps.sql, userId),
  });
}

export async function generateRoutes(
  deps: GeoDeps,
  userId: string,
  input: GenerateRoutesRequest,
): Promise<{ routes: RouteCandidate[] }> {
  if (deps.routeProvider === null) {
    throw new GeoError(503, "route_unavailable", "Route generation is temporarily unavailable.");
  }
  const provider = deps.routeProvider;
  const routes: RouteCandidate[] = [];
  for (const seed of routeSeeds(input.count)) {
    let candidate: RouteCandidate;
    try {
      candidate = await provider.generate({ lat: input.lat, lng: input.lng, targetKm: input.targetKm, seed });
    } catch (err) {
      // Fail-closed: no mock fallback. Log the cause (event + error name only,
      // R3.10 — never the coordinates/polyline) and surface a typed 503.
      deps.log.warn(
        { event: "geo.ors_failed", userId, errName: err instanceof Error ? err.name : typeof err },
        "ORS route generation failed",
      );
      throw new GeoError(503, "route_unavailable", "Route generation is temporarily unavailable. Please try again shortly.");
    }
    await routeLedger(deps, userId);
    routes.push(candidate);
  }
  return { routes };
}

// ── saved_routes CRUD (thin seams — a place for future authz/entitlement
//    hooks, matching the nutrition module's boundary) ─────────────────────────

const asSavedRoute = (r: repo.SavedRouteRow): SavedRoute => ({
  id: r.id,
  name: r.name,
  polyline: r.polyline,
  distanceM: r.distanceM,
  createdAt: r.createdAt.toISOString(),
});

export async function createSavedRoute(deps: ReadDeps, userId: string, input: SavedRouteCreate): Promise<SavedRoute> {
  const row = await repo.createSavedRoute(deps.sql, userId, input);
  return asSavedRoute(row);
}

export async function listSavedRoutes(
  deps: ReadDeps,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<{ items: SavedRoute[]; next: repo.SavedRouteRow | null }> {
  const rows = await repo.listSavedRoutes(deps.sql, userId, limit, cursor);
  const page = rows.slice(0, limit);
  return { items: page.map(asSavedRoute), next: rows.length > limit ? (page.at(-1) ?? null) : null };
}

export async function getSavedRoute(deps: ReadDeps, userId: string, id: string): Promise<SavedRoute | null> {
  const row = await repo.getSavedRoute(deps.sql, userId, id);
  return row === null ? null : asSavedRoute(row);
}

export async function deleteSavedRoute(deps: ReadDeps, userId: string, id: string): Promise<boolean> {
  return await repo.deleteSavedRoute(deps.sql, userId, id);
}

// ── runs read (record/sync = P5) ─────────────────────────────────────────────

const asRunSummary = (r: repo.RunRow): RunSummary => ({
  id: r.id,
  startedAt: r.startedAt.toISOString(),
  durationS: r.durationS,
  distanceM: r.distanceM,
  routeName: r.routeName,
  kcalPoint: r.kcalPoint,
  source: r.source,
});

export async function listRuns(
  deps: ReadDeps,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<{ items: RunSummary[]; next: repo.RunRow | null }> {
  const rows = await repo.listRuns(deps.sql, userId, limit, cursor);
  const page = rows.slice(0, limit);
  return { items: page.map(asRunSummary), next: rows.length > limit ? (page.at(-1) ?? null) : null };
}

export async function getRun(deps: ReadDeps, userId: string, id: string): Promise<RunDetail | null> {
  const row = await repo.getRun(deps.sql, userId, id);
  // Detail includes the polyline (owner-only — the route WHERE already bound it
  // to userId; it is never logged or returned to any other user).
  return row === null ? null : { ...asRunSummary(row), polyline: row.polyline };
}
