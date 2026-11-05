// P2.6b — geo service: route generation orchestration + saved_routes/runs read
// seams. Route generation is fail-closed (v1 §9.3): no ORS key or an ORS blip →
// typed 503, NEVER a mock fallback (the salvage's mock generator is
// deliberately not ported — DECISIONS 2026-07-13). Scoring + weather are
// deferred to @app/engine / P5 (v1 §12); this returns normalized ORS
// candidates only.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { RUN_CALC_VERSION, encodePolyline, runSplitSchema, runSums } from "@app/shared";
import type { GenerateRoutesRequest, RouteCandidate, SavedRoute, SavedRouteCreate, RunDetail, RunSummary, SaveRunRequest, SavedRun } from "@app/shared";
import { z } from "zod";
import { onWorkoutSynced } from "../gamification/service.js";
import { getUserSyncContext } from "../users/service.js";
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

export async function runTotals(deps: ReadDeps, userId: string, since: Date | null) {
  return repo.getRunTotals(deps.sql, userId, since);
}

export async function runDays(deps: ReadDeps, userId: string, since: Date | null, timeZone: string) {
  return repo.getRunDays(deps.sql, userId, since, timeZone);
}

export async function getRun(deps: ReadDeps, userId: string, id: string): Promise<RunDetail | null> {
  const row = await repo.getRun(deps.sql, userId, id);
  // Detail includes the polyline (owner-only — the route WHERE already bound it
  // to userId; it is never logged or returned to any other user).
  return row === null ? null : { ...asRunSummary(row), polyline: row.polyline };
}

// ── Record a run (ROADMAP 37a) ─────────────────────────────────────────────────────────────────

/** A saved run's splits, and where each stretch of its line begins (a pause, a stretch left out):
 *  whatever draws it later starts the line again there, never across the gap. */
const splitsStoredSchema = z.object({
  km: z.array(runSplitSchema),
  mi: z.array(runSplitSchema),
  starts: z.array(z.number().int().nonnegative()).optional(),
});

const asSavedRun = (r: repo.SavedRunRow): SavedRun => {
  const splits = splitsStoredSchema.safeParse(r.splits);
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    name: r.name ?? "Run",
    effort: r.effort,
    note: r.note,
    distanceM: r.distanceM,
    movingS: r.movingS,
    elapsedS: r.elapsedS ?? r.movingS,
    leftOutM: r.leftOutM ?? 0,
    leftOutS: r.leftOutS ?? 0,
    kcal: r.kcal ?? 0,
    splitsKm: splits.success ? splits.data.km : [],
    splitsMi: splits.success ? splits.data.mi : [],
    polyline: r.polyline ?? "",
    trackStarts: splits.success ? (splits.data.starts ?? [0]) : [0],
  };
};

/** A run this person has already saved under this id, read before any of its points are: a send
 *  repeated is answered from the row at no cost (round one of 37a, H2). null when there is none. */
export async function savedRunIfAny(deps: ReadDeps, userId: string, runId: string): Promise<SavedRun | null> {
  const row = await repo.getSavedRun(deps.sql, userId, runId);
  return row === null ? null : asSavedRun(row);
}

/** A phone's clock can be fast. A run that seems to end after the server's own now is moved back
 *  to end now: the run is kept, never refused (round one of 37a, H1). */
export function startedAtKept(sent: Date, elapsedMs: number, now: Date): Date {
  return sent.getTime() + elapsedMs > now.getTime() ? new Date(now.getTime() - elapsedMs) : sent;
}

/** Works every number out from the points with the shared rules and saves the run once. The
 *  person's weight is the one they keep (70 kg when there is none), as workouts' calories are. */
export async function saveRun(
  deps: ReadDeps & { now: () => Date },
  userId: string,
  input: SaveRunRequest,
): Promise<{ status: "created" | "duplicate"; run: SavedRun }> {
  const startedAt = startedAtKept(new Date(input.startedAt), input.elapsedMs, deps.now());
  const ctx = await getUserSyncContext(deps.sql, userId);
  const sums = runSums(input.points, input.pauses, input.elapsedMs, ctx.weightKg ?? 0);
  const note = input.note === null || input.note === "" ? null : input.note;
  const saved = await repo.insertRun(deps.sql, userId, {
    id: input.runId,
    startedAt,
    name: input.name,
    effort: input.effort,
    note,
    distanceM: sums.distanceM,
    movingS: sums.movingS,
    elapsedS: sums.elapsedS,
    leftOutM: sums.leftOutM,
    leftOutS: sums.leftOutS,
    kcal: sums.kcal,
    splits: { km: sums.splitsKm, mi: sums.splitsMi, starts: sums.trackStarts },
    polyline: encodePolyline(sums.track),
    calcVersion: RUN_CALC_VERSION,
  });
  // On every send, a repeat included, as a workout's sync does: the streak, badges and XP are
  // worked out again from history, so a send whose first try failed here heals on the next.
  await onWorkoutSynced({ sql: deps.sql }, userId, ctx.timezone);
  return { status: saved.created ? "created" : "duplicate", run: asSavedRun(saved.row) };
}
