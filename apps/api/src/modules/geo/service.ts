// P2.6b — geo service: route generation orchestration + saved_routes/runs read
// seams. Route generation is fail-closed (v1 §9.3): no ORS key or an ORS blip →
// typed 503, NEVER a mock fallback (the salvage's mock generator is
// deliberately not ported — DECISIONS 2026-07-13). Scoring + weather are
// deferred to @app/engine / P5 (v1 §12); this returns normalized ORS
// candidates only.
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { RUN_CALC_VERSION, runPlanAnswersSchema, runPlanOf, runsFrom, climbFromHeights, climbSamples, decodePolyline, encodePolyline, hillLineOf, hillLineSchema, paceLineSchema, routeShape, runSplitSchema, runSums } from "@app/shared";
import type {
  GenerateRoutesRequest,
  RouteCandidate,
  RunClimb,
  RunClimbRequest,
  SavedRoute,
  SavedRouteCreate,
  ChangeRunRequest,
  RunDaysResponse,
  RunDetail,
  RunMonthTotal,
  RunRecord,
  RunRecordKind,
  RunPlanAnswers,
  RunPlanResponse,
  RunRecords,
  RunSummary,
  SaveRunRequest,
  SavedRun,
} from "@app/shared";
import { z } from "zod";
import { onWorkoutSynced } from "../gamification/service.js";
import { dayInTz, safeTimeZone } from "../gamification/streak.js";
import { getUserPlanAndCutRules, getUserSyncContext } from "../users/service.js";
import { GeoError } from "./errors.js";
import type { HeightMap } from "./heights.adapter.js";
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
  name: r.name ?? r.routeName ?? "Run",
  day: r.day,
  elapsedS: Math.max(r.elapsedS ?? r.durationS, r.durationS),
  climbM: r.climbM,
  shape: r.shape,
});

/** The person's own time zone, for days and months (an unknown one reads as UTC). */
const zoneOf = async (deps: ReadDeps, userId: string): Promise<string> => safeTimeZone((await getUserSyncContext(deps.sql, userId)).timezone);

/** Where each stretch of a saved line begins, as its splits keep them. */
const startsOf = (splits: unknown): number[] => {
  const kept = splitsStoredSchema.safeParse(splits);
  return kept.success ? (kept.data.starts ?? [0]) : [0];
};

/** The old app's path (`tools/migrate-mongo` keeps it as its JSON): [lat, lng] pairs or {lat, lng}
 *  points. Read through its shape: anything else is no route at all, never a made-up one. */
const legacyPointSchema = z.union([
  z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]).rest(z.unknown()),
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).transform((p): [number, number] => [p.lat, p.lng]),
  z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).transform((p): [number, number] => [p.lat, p.lon]),
]);
const legacyPathSchema = z.array(legacyPointSchema).min(2);

/** A saved line's points: the coded line this app saves, or an old app's path read through its shape;
 *  null where an old app's path cannot be read. */
export function lineOf(polyline: string, legacy: boolean): [number, number][] | null {
  if (!legacy) return decodePolyline(polyline);
  let raw: unknown;
  try {
    raw = JSON.parse(polyline);
  } catch {
    return null;
  }
  const read = legacyPathSchema.safeParse(raw);
  return read.success ? read.data.map((p): [number, number] => [p[0], p[1]]) : null;
}

/** A run saved before 37c-i has no shape: made from its saved line once, and kept. */
async function withShape<T extends repo.RunRow>(deps: ReadDeps, userId: string, row: T): Promise<T> {
  if (row.shape !== null || row.shapeFrom === null) return row;
  const line = lineOf(row.shapeFrom.polyline, row.legacy);
  if (line === null) return row;
  const shape = routeShape(line, row.legacy ? [0] : startsOf(row.shapeFrom.splits));
  if (shape === null) return row;
  await repo.keepRunShape(deps.sql, userId, row.id, shape);
  return { ...row, shape };
}

/** A page of the person's runs, newest first, from the cursor or from the end of the day `upTo`; with
 *  each month the page touches, whole, and every run they have counted. */
export async function listRuns(
  deps: ReadDeps,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
  upTo: string | null = null,
): Promise<{ items: RunSummary[]; next: repo.RunRow | null; months: RunMonthTotal[]; total: { runs: number; distanceM: number } }> {
  const timeZone = await zoneOf(deps, userId);
  const rows = await repo.listRuns(deps.sql, userId, limit, cursor, timeZone, upTo);
  const page = rows.slice(0, limit);
  const shaped: repo.RunRow[] = [];
  for (const row of page) shaped.push(await withShape(deps, userId, row));
  const months = [...new Set(page.map((r) => r.day.slice(0, 7)))];
  const [totals, total] = await Promise.all([repo.getRunMonths(deps.sql, userId, timeZone, months), repo.getRunCount(deps.sql, userId)]);
  return {
    items: shaped.map(asRunSummary),
    next: rows.length > limit ? (page.at(-1) ?? null) : null,
    months: months.flatMap((m) => totals.filter((t) => t.month === m)),
    total,
  };
}

/** The calendar's month: each day the person ran, and the day of their first run. */
export async function runCalendar(deps: ReadDeps, userId: string, month: string): Promise<RunDaysResponse> {
  const timeZone = await zoneOf(deps, userId);
  const [days, first] = await Promise.all([repo.getRunCalendar(deps.sql, userId, timeZone, month), repo.getFirstRunDay(deps.sql, userId, timeZone)]);
  return { month, days, first };
}

export async function runTotals(deps: ReadDeps, userId: string, since: Date | null) {
  return repo.getRunTotals(deps.sql, userId, since);
}

export async function runDays(deps: ReadDeps, userId: string, since: Date | null, timeZone: string) {
  return repo.getRunDays(deps.sql, userId, since, timeZone);
}

const asRunDetail = (row: repo.RunDetailRow): RunDetail => {
  const splits = splitsStoredSchema.safeParse(row.splits);
  // The phone draws a coded line: an old app's path is sent as one, or not at all where it cannot be read.
  const line = row.polyline === null ? null : lineOf(row.polyline, row.legacy);
  return {
    ...asRunSummary(row),
    polyline: line === null || row.polyline === null ? null : row.legacy ? encodePolyline(line) : row.polyline,
    trackStarts: row.legacy ? [0] : splits.success ? (splits.data.starts ?? [0]) : [0],
    splitsKm: splits.success ? splits.data.km : [],
    splitsMi: splits.success ? splits.data.mi : [],
    paceLine: splits.success && !row.legacy ? (splits.data.pace ?? []) : [],
    hillLine: splits.success && !row.legacy ? (splits.data.hills ?? []) : [],
    effort: row.effort,
    note: row.note,
    leftOutM: row.leftOutM ?? 0,
    leftOutS: row.leftOutS ?? 0,
    bests: row.bests,
    records: [],
  };
};

/** The records this run holds now, from the person's records (37c-ii). */
const heldBy = (records: readonly repo.RunRecordRow[], runId: string): RunRecordKind[] =>
  records.filter((r) => r.runId === runId).map((r) => r.kind);

export async function getRun(deps: ReadDeps, userId: string, id: string): Promise<RunDetail | null> {
  const timeZone = await zoneOf(deps, userId);
  const row = await repo.getRun(deps.sql, userId, id, timeZone);
  // Detail includes the polyline (owner-only — the route WHERE already bound it
  // to userId; it is never logged or returned to any other user).
  if (row === null) return null;
  const detail = asRunDetail(await withShape(deps, userId, row));
  return { ...detail, records: heldBy(await repo.getRunRecords(deps.sql, userId, timeZone), id) };
}

/** The person's running records (37c-ii): each null while not set. */
export async function runRecords(deps: ReadDeps, userId: string): Promise<RunRecords> {
  const rows = await repo.getRunRecords(deps.sql, userId, await zoneOf(deps, userId));
  const of = (kind: RunRecordKind): RunRecord | null => {
    const r = rows.find((x) => x.kind === kind);
    return r === undefined ? null : { runId: r.runId, name: r.name ?? "Run", startedAt: r.startedAt.toISOString(), day: r.day, value: r.value, before: r.before };
  };
  return { k1: of("k1"), mile: of("mile"), k5: of("k5"), k10: of("k10"), longest: of("longest") };
}

/** The person changes their own run's name, how it felt or its note (37c-i); its numbers never. Null
 *  when they have no run by this id. */
export async function changeRun(deps: ReadDeps, userId: string, id: string, input: ChangeRunRequest): Promise<RunDetail | null> {
  const note = input.note === undefined ? undefined : input.note === null || input.note === "" ? null : input.note;
  const timeZone = await zoneOf(deps, userId);
  const row = await repo.changeRun(deps.sql, userId, id, { name: input.name, effort: input.effort, note }, timeZone);
  return row === null ? null : { ...asRunDetail(row), records: heldBy(await repo.getRunRecords(deps.sql, userId, timeZone), id) };
}

/** The person deletes their own run (37c-i): it and its route go for good, and the streak, badges and
 *  XP are worked out again from what is left, as after any sync. False: no run of theirs by this id. */
export async function deleteRun(deps: ReadDeps, userId: string, id: string): Promise<boolean> {
  if (!(await repo.removeRun(deps.sql, userId, id))) return false;
  await onWorkoutSynced({ sql: deps.sql }, userId, (await getUserSyncContext(deps.sql, userId)).timezone);
  return true;
}

// ── Record a run (ROADMAP 37a) ─────────────────────────────────────────────────────────────────

/** A saved run's splits, and where each stretch of its line begins (a pause, a stretch left out):
 *  whatever draws it later starts the line again there, never across the gap. */
const splitsStoredSchema = z.object({
  km: z.array(runSplitSchema),
  mi: z.array(runSplitSchema),
  starts: z.array(z.number().int().nonnegative()).optional(),
  /** The pace chart's two lines (37c-iii); a run saved before it has neither. */
  pace: paceLineSchema.optional(),
  hills: hillLineSchema.optional(),
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
    climbM: r.climbM,
  };
};

// ── A run's elevation gain (ROADMAP 37b-ii) ─────────────────────────────────────────────────────

/** How long saving a run waits for a piece of the height map it does not have yet; past it, the run is
 *  saved waiting and the worker works the climb out once the piece is here. */
export const SAVE_CLIMB_WAIT_MS = 10_000;
/** How long the summary's ask waits: the phone shows "--" meanwhile, and asks again past it. */
export const ASK_CLIMB_WAIT_MS = 25_000;

/** The metres climbed along a run's saved line (as `encodePolyline` keeps it, so the summary's ask,
 *  the save and the worker read the very same places), from the server's height map; with the hills
 *  behind its pace chart at `places` places (the pace line's length). */
export async function climbOfLine(heights: HeightMap, polyline: string, starts: readonly number[], waitMs: number, asker: string, places: number): Promise<RunClimb> {
  const line = decodePolyline(polyline);
  if (line.length < 2) return { state: "done", m: 0, hills: [] };
  const samples = climbSamples(line, starts);
  const got = await heights.heightsAt(samples.at, waitMs, asker);
  if (got === "waiting") return { state: "waiting" };
  const m = climbFromHeights(got, samples.apart);
  return m === null ? { state: "none" } : { state: "done", m, hills: hillLineOf(got, samples.apart, places) };
}

/** The summary's ask: the run's line worked out as saving it would, its climb read, nothing kept. */
export async function askClimb(deps: { heights: HeightMap }, input: RunClimbRequest, userId: string): Promise<RunClimb> {
  const sums = runSums(input.points, input.pauses, input.elapsedMs, 0);
  return await climbOfLine(deps.heights, encodePolyline(sums.track), sums.trackStarts, ASK_CLIMB_WAIT_MS, userId, sums.paceLine.length);
}

/** A run still waiting this long after it was saved gives up: its map never came. */
export const CLIMB_GIVE_UP_DAYS = 3;

/** The runs whose climb waited for the height map, worked out again now: up to `limit` of them, newest
 *  first, for `mostMs` at most (the worker's queue is shared), each kept only while it still waits, so
 *  two workers at once change nothing twice. Runs waiting past CLIMB_GIVE_UP_DAYS have none. */
export async function workOutWaitingClimbs(
  deps: { sql: Sql; heights: HeightMap; log: Pick<FastifyBaseLogger, "error">; now?: () => number },
  opts: { limit: number; waitMs: number; mostMs: number },
): Promise<{ looked: number; kept: number; stillWaiting: number; gaveUp: number }> {
  const now = deps.now ?? Date.now;
  const until = now() + opts.mostMs;
  const gaveUp = await repo.giveUpOldClimbs(deps.sql, CLIMB_GIVE_UP_DAYS);
  const runs = await repo.listWaitingClimbs(deps.sql, opts.limit);
  let kept = 0;
  let stillWaiting = 0;
  for (const run of runs) {
    if (now() >= until) {
      stillWaiting++;
      continue;
    }
    const splits = splitsStoredSchema.safeParse(run.splits);
    let climb: RunClimb;
    try {
      const places = splits.success ? (splits.data.pace?.length ?? 0) : 0;
      climb = run.polyline === null ? { state: "done", m: 0, hills: [] } : await climbOfLine(deps.heights, run.polyline, splits.success ? (splits.data.starts ?? [0]) : [0], opts.waitMs, run.userId, places);
    } catch (err) {
      deps.log.error({ event: "geo.climb_failed", runId: run.id, errName: err instanceof Error ? err.name : typeof err }, "elevation gain not worked out");
      climb = { state: "waiting" };
    }
    if (climb.state === "waiting") {
      stillWaiting++;
      continue;
    }
    if (await repo.keepWaitingClimb(deps.sql, run, climb)) kept++;
  }
  return { looked: runs.length, kept, stillWaiting, gaveUp };
}

/** A run this person has already saved under this id, read before any of its points are: a send
 *  repeated is answered from the row at no cost (round one of 37a, H2). null when there is none. */
/** A run sent again: as saved, "removed" when the person deleted it, null when it is new. */
export async function savedRunIfAny(deps: ReadDeps, userId: string, runId: string): Promise<SavedRun | "removed" | null> {
  const row = await repo.getSavedRun(deps.sql, userId, runId);
  if (row !== null) return asSavedRun(row);
  return (await repo.wasRunRemoved(deps.sql, userId, runId)) ? "removed" : null;
}

/** A run sent after the person deleted it: nothing is kept (37c-i). */
export class RemovedRunError extends Error {
  constructor() {
    super("the run was deleted");
    this.name = "RemovedRunError";
  }
}

/** A phone's clock can be fast. A run that seems to end after the server's own now is moved back
 *  to end now: the run is kept, never refused (round one of 37a, H1). */
export function startedAtKept(sent: Date, elapsedMs: number, now: Date): Date {
  return sent.getTime() + elapsedMs > now.getTime() ? new Date(now.getTime() - elapsedMs) : sent;
}

/** Works every number out from the points with the shared rules and saves the run once. The
 *  person's weight is the one they keep (70 kg when there is none), as workouts' calories are. */
export async function saveRun(
  deps: ReadDeps & { now: () => Date; heights: HeightMap; log: Pick<FastifyBaseLogger, "error"> },
  userId: string,
  input: SaveRunRequest,
): Promise<{ status: "created" | "duplicate"; run: SavedRun }> {
  const startedAt = startedAtKept(new Date(input.startedAt), input.elapsedMs, deps.now());
  const ctx = await getUserSyncContext(deps.sql, userId);
  const sums = runSums(input.points, input.pauses, input.elapsedMs, ctx.weightKg ?? 0);
  const note = input.note === null || input.note === "" ? null : input.note;
  const polyline = encodePolyline(sums.track);
  // The run is saved whatever the height map does: anything wrong there leaves its climb waiting.
  let climb: RunClimb;
  try {
    climb = await climbOfLine(deps.heights, polyline, sums.trackStarts, SAVE_CLIMB_WAIT_MS, userId, sums.paceLine.length);
  } catch (err) {
    deps.log.error({ event: "geo.climb_failed", errName: err instanceof Error ? err.name : typeof err }, "elevation gain not worked out");
    climb = { state: "waiting" };
  }
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
    splits: { km: sums.splitsKm, mi: sums.splitsMi, starts: sums.trackStarts, pace: sums.paceLine, hills: climb.state === "done" ? climb.hills : [] },
    polyline,
    calcVersion: RUN_CALC_VERSION,
    climb,
    shape: routeShape(sums.track, sums.trackStarts),
    bests: sums.bests,
  });
  if (saved === "removed") throw new RemovedRunError();
  // On every send, a repeat included, as a workout's sync does: the streak, badges and XP are
  // worked out again from history, so a send whose first try failed here heals on the next.
  await onWorkoutSynced({ sql: deps.sql }, userId, ctx.timezone);
  return { status: saved.created ? "created" : "duplicate", run: asSavedRun(saved.row) };
}

// ── The run plan (ROADMAP 37d-i) ──────────────────────────────────────────────────────────────

/** Answers kept before a rule changed and no longer read are treated as none: the person answers again. */
const answersOf = (stored: unknown): RunPlanAnswers | null => {
  const parsed = runPlanAnswersSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
};

/** The person's answers and the plan from them and from the runs they recorded. Safe mode makes no
 *  plan, answered or not, and says so. */
export async function runPlan(deps: ReadDeps & { now: () => Date }, userId: string): Promise<RunPlanResponse> {
  const [row, ctx, rules] = await Promise.all([
    repo.getRunPlan(deps.sql, userId),
    getUserSyncContext(deps.sql, userId),
    getUserPlanAndCutRules(deps.sql, userId, null),
  ]);
  const safeMode = rules.answers.health?.safeMode === true;
  const answers = row === null ? null : answersOf(row.answers);
  if (safeMode) return { answers, plan: { kind: "none", why: "safe_mode" } };
  if (row === null || answers === null) return { answers: null, plan: null };
  const timeZone = safeTimeZone(ctx.timezone);
  const today = dayInTz(deps.now(), timeZone);
  const answeredDay = dayInTz(row.answeredAt, timeZone);
  const runs = answers.doesRun === "no" ? [] : await repo.getRunPlanDays(deps.sql, userId, timeZone, runsFrom(answeredDay, today));
  return { answers, plan: runPlanOf({ answers, answeredDay, today, safeMode, runs }) };
}

export async function setRunPlan(deps: ReadDeps & { now: () => Date }, userId: string, answers: RunPlanAnswers): Promise<RunPlanResponse> {
  await repo.putRunPlan(deps.sql, userId, answers, deps.now());
  return runPlan(deps, userId);
}
