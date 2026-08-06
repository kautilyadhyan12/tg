// P1.10d/P2.3 — workouts service: orchestration between route and repo
// (v1 §6.2). P2.3 adds: kcal at sync (2B §2.2), the gamification hook
// (cross-module via service interface, R7.1), history pages, and the
// progress.py ports. Retry-safety (R3.5): everything behind a duplicate
// sync is either keyed-idempotent or skipped on status==='duplicate'.
import type { Sql } from "postgres";
import {
  getMe as getGamificationMe,
  isContinuationDay,
  onWorkoutSynced,
  reconciledStreak,
  safeTimeZone,
} from "../gamification/service.js";
import { xpEarnedForWorkout } from "../gamification/xp.js";
import {
  mealSuggestionsFor,
  personalRecordsFor,
  primaryMusclesFor,
  stretchesFor,
} from "./summaryContent.js";
import { getEntitlements } from "../entitlements/service.js";
import type { RedisLike } from "../../redis.js";
import { z } from "zod";
import { getUserSyncContext } from "../users/service.js";
import { KCAL_CALC_VERSION, kcalPointForSets } from "./calories.js";
import * as repo from "./repo.js";
import type {
  PersonalRecords,
  ProgressDistribution,
  ProgressHeatmap,
  ProgressOverview,
  ProgressPeriod,
  ProgressTrend,
  ProgressWeekly,
  SyncResponse,
  WorkoutDetail,
  WorkoutListQuery,
  WorkoutPage,
  WorkoutSummary,
  WorkoutSyncPayload,
} from "./schemas.js";

export async function handleWorkoutSync(
  sql: Sql,
  userId: string,
  payload: WorkoutSyncPayload,
): Promise<SyncResponse & { skippedSets: number }> {
  const slugs = [...new Set(payload.sets.map((s) => s.exercise))];
  const exerciseBySlug = await repo.getExerciseIdsBySlug(sql, slugs);
  const ctx = await getUserSyncContext(sql, userId);

  // 2B §2.2: kcal computed server-side at sync, ACTIVE time only (GAP-2),
  // MET per exercise from the catalog, weight from users (70 kg fallback).
  const kcalInputs = payload.sets
    .map((s) => ({ ref: exerciseBySlug.get(s.exercise), durationMs: s.durationMs }))
    .filter((x): x is { ref: repo.ExerciseRef; durationMs: number } => x.ref !== undefined)
    .map((x) => ({ met: x.ref.met, durationMs: x.durationMs }));
  const kcal = { point: kcalPointForSets(kcalInputs, ctx.weightKg), calcVersion: KCAL_CALC_VERSION };

  const outcome = await repo.syncWorkout(sql, userId, payload, exerciseBySlug, kcal);

  // UNCONDITIONAL (T3 P2.3 finding 2): the workout commit and this hook are
  // not atomic, so a throw here followed by a client retry (which reads
  // 'duplicate') must still re-run it. Safe because the hook recomputes the
  // streak from history and awards upsert — idempotent by construction (R3.5).
  await onWorkoutSynced({ sql }, userId, ctx.timezone);

  return { workoutId: payload.workoutId, status: outcome.status, skippedSets: outcome.skippedSets };
}

// ── history ──────────────────────────────────────────────────────────────────

export interface ReadDeps {
  sql: Sql;
  redis: RedisLike;
}

/** Part 4 §0.2 read-gate (P2.4 GAP-4/GAP-6): free plans see history_days
 *  days back; -1 = unlimited. Reads the keystone resolver (v1 §8) — never
 *  its own idea of the plan. */
async function historyGate(
  deps: ReadDeps,
  userId: string,
): Promise<{ floor: Date | null; limitedToDays: number | null }> {
  const { entitlements } = await getEntitlements(deps, userId);
  const days = entitlements.history_days;
  if (days === -1) return { floor: null, limitedToDays: null };
  return { floor: new Date(Date.now() - days * 86_400_000), limitedToDays: days };
}

/** Later of the requested window and the plan floor. */
const clamp = (since: Date | null, floor: Date | null): Date | null =>
  floor === null ? since : since === null || floor > since ? floor : since;

/** Opaque-ish cursor: `<startedAt ISO>|<uuid>`. Malformed → null (treated as
 *  first page — never a 500 from a hand-edited cursor). */
function parseCursor(cursor: string | undefined): { startedAt: Date; id: string } | null {
  if (cursor === undefined) return null;
  const sep = cursor.indexOf("|");
  if (sep === -1) return null;
  const startedAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  // Strict uuid shape (T3 P2.3 nit): a looser pattern let 36 hex-ish chars
  // through to the PG uuid cast → 500, breaking this function's contract.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Number.isNaN(startedAt.getTime()) || !uuidRe.test(id)) return null;
  return { startedAt, id };
}

// Parse, don't cast (R2.2/R2.3; T3 P2.3 finding 3): the DB CHECK constrains
// platform, and this re-proves it at runtime on the way out.
const platformSchema = z.enum(["web", "android", "ios"]);

const toListItem = (w: repo.WorkoutRow) => ({
  id: w.id,
  startedAt: w.startedAt.toISOString(),
  platform: platformSchema.parse(w.platform),
  setsCount: w.setsCount,
  totalReps: w.totalReps,
  avgFormScore: w.avgFormScore,
  durationMs: w.durationMs,
  kcalPoint: w.kcalPoint,
  kcalCalcVersion: w.kcalCalcVersion,
  qualityFlags: w.qualityFlags,
});

export async function listWorkouts(
  deps: ReadDeps,
  userId: string,
  query: WorkoutListQuery,
): Promise<WorkoutPage> {
  const gate = await historyGate(deps, userId);
  // The requested window NARROWS; the plan floor is the later of the two, so a
  // `from` older than the gate can never read past it (R3.1 — the server owns
  // what the plan grants, and a query parameter is not a plan).
  const rows = await repo.listWorkouts(deps.sql, userId, {
    limit: query.limit,
    cursor: parseCursor(query.cursor),
    since: clamp(query.from === undefined ? null : new Date(query.from), gate.floor),
    until: query.to === undefined ? null : new Date(query.to),
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map(toListItem),
    nextCursor: hasMore && last !== undefined ? `${last.startedAt.toISOString()}|${last.id}` : null,
    limitedToDays: gate.limitedToDays,
  };
}

export async function getWorkout(
  sql: Sql,
  userId: string,
  workoutId: string,
): Promise<WorkoutDetail | null> {
  const found = await repo.getWorkoutDetail(sql, userId, workoutId);
  if (found === null) return null;
  return {
    ...toListItem(found.workout),
    engineVersion: found.workout.engineVersion,
    bundleVersion: found.workout.bundleVersion,
    sets: found.sets.map((s) => ({
      setIndex: s.setIndex,
      exerciseSlug: s.exerciseSlug,
      view: s.view,
      reps: s.reps,
      holdMs: s.holdMs,
      durationMs: s.durationMs,
      avgFormScore: s.avgFormScore,
      // jsonb → runtime-checked shapes (R2.3); stored by our own sync parser,
      // so failure means DB drift — surfaced as 500, not silently served.
      repScores: s.repScores,
      faultCounts: asNumberRecord(s.faultCounts),
      tempoMsAvg: s.tempoMsAvg,
      romStats: s.romStats === null ? null : asNumberRecord(s.romStats),
      // Carried out to the client so a reader can tell a MEASUREMENT from a
      // number the user typed. Null = stored before migration 0009, i.e.
      // unknown — never silently presented as either.
      mode: s.mode,
      engineVersion: s.engineVersion,
      definitionVersion: s.definitionVersion,
    })),
  };
}

/** The post-workout summary (v1 §6.1 workouts "history, PRs"; the new-API home
 *  for the old backend's `GET /workouts/:id/summary`).
 *
 *  COMPOSED FROM READS THAT ALREADY EXIST, deliberately. The workout and its
 *  sets come from `getWorkoutDetail` — which is keyed `(id, userId)`, so a
 *  foreign id reads as absent and this function inherits that tenancy rather
 *  than re-implementing it (R3.2). The records come from the same
 *  `personalRecords` the records screen reads, so the two cannot disagree about
 *  who holds a record. XP and streak come from the gamification module through
 *  its service interface (R7.1), never from its tables.
 *
 *  Returns NULL for "no such workout for this user" — the route maps that to the
 *  same 404 a bad id gets, so the response is not an existence oracle. */
export async function getWorkoutSummary(
  deps: ReadDeps,
  userId: string,
  workoutId: string,
): Promise<WorkoutSummary | null> {
  const found = await repo.getWorkoutDetail(deps.sql, userId, workoutId);
  if (found === null) return null;
  const { workout, sets } = found;

  const ctx = await getUserSyncContext(deps.sql, userId);
  const tz = safeTimeZone(ctx.timezone);
  // The records come from `repo.getPersonalRecords` under the SAME plan gate the
  // records screen uses, rather than from the `personalRecords` SERVICE (T3
  // round 1, L-6). The service additionally reconciles the streak and re-reads
  // the user context — both of which `getGamificationMe` below already do — so
  // calling it here ran `SELECT … FOR UPDATE` twice per summary read on a
  // single-connection pool, serialized, for a value that was then discarded.
  // The guarantee that matters is unchanged: same query, same gate, so the
  // summary and the records screen cannot disagree about who holds a record.
  const gate = await historyGate(deps, userId);
  const [me, records, isContinuation, hasEarlierToday] = await Promise.all([
    getGamificationMe({ sql: deps.sql }, userId, ctx.timezone),
    repo.getPersonalRecords(deps.sql, userId, gate.floor),
    isContinuationDay({ sql: deps.sql }, userId, ctx.timezone, workout.startedAt),
    repo.hasEarlierWorkoutOnDay(deps.sql, userId, workout.id, workout.startedAt, tz),
  ]);

  // ONE STREAK BONUS PER DAY, awarded to the day's FIRST workout — see
  // `hasEarlierWorkoutOnDay`. Crediting it per workout made two summaries on one
  // day claim +60 each while the XP total moved by 110 (T3 round 1, C/H-1).
  const isStreakContinuation = isContinuation && !hasEarlierToday;

  // Active time = the sum of the per-set durations, i.e. time actually spent
  // mid-set. Whole seconds, floored: `secondsLabel` on the client carries to
  // "1m 60s" on fractional input (its own OWED line), and a duration should not
  // change units on the way to a label (DECISIONS :4182).
  const activeMs = sets.reduce((total, s) => total + s.durationMs, 0);

  return {
    workoutId: workout.id,
    startedAt: workout.startedAt.toISOString(),
    // No sets is not reachable through sync (the contract requires ≥1), but an
    // empty sum would report 0 seconds of activity as if measured — null says
    // "unknown" instead, which is what the client's UNKNOWN arm is for.
    activeSeconds: sets.length === 0 ? null : Math.floor(activeMs / 1000),
    durationSeconds: workout.durationMs === null ? null : Math.floor(workout.durationMs / 1000),
    caloriesBurned: workout.kcalPoint,
    formAccuracy: workout.avgFormScore,
    exercisesCount: new Set(sets.map((s) => s.exerciseSlug)).size,
    currentStreak: me.streak.current,
    currentLevel: me.xp.level,
    currentXp: me.xp.total,
    xpEarned: xpEarnedForWorkout({ avgFormScore: workout.avgFormScore, isStreakContinuation }),
    personalRecords: personalRecordsFor(workout.id, {
      maxKcalWorkoutId: records.maxKcalWorkout?.workoutId ?? null,
      longestWorkoutId: records.longestWorkout?.workoutId ?? null,
      bestAvgFormWorkoutId: records.bestAvgForm?.workoutId ?? null,
      maxKcalValue: records.maxKcalWorkout?.value ?? null,
      longestValue: records.longestWorkout?.value ?? null,
      bestAvgFormValue: records.bestAvgForm?.value ?? null,
    }),
    mealSuggestions: mealSuggestionsFor(workout.kcalPoint),
    stretches: stretchesFor(primaryMusclesFor(sets.map((s) => s.exerciseSlug))),
  };
}

function asNumberRecord(v: unknown): Record<string, number> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error("stored jsonb is not an object");
  }
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "number") throw new Error(`stored jsonb key ${k} is not a number`);
    out[k] = val;
  }
  return out;
}

// ── progress (progress.py ports) ─────────────────────────────────────────────

/** progress.py:13-19 verbatim period → since instant. */
function sinceFor(period: ProgressPeriod, now: Date): Date | null {
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 86_400_000);
    case "30d":
      return new Date(now.getTime() - 30 * 86_400_000);
    case "90d":
      return new Date(now.getTime() - 90 * 86_400_000);
    case "1y":
      return new Date(now.getTime() - 365 * 86_400_000);
    case "all":
      return null;
  }
}

async function userTz(sql: Sql, userId: string): Promise<string> {
  const ctx = await getUserSyncContext(sql, userId);
  return safeTimeZone(ctx.timezone);
}

export async function progressOverview(
  deps: ReadDeps,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressOverview> {
  const now = new Date();
  const gate = await historyGate(deps, userId);
  const since = clamp(sinceFor(period, now), gate.floor);
  const [agg, streak] = await Promise.all([
    repo.getOverviewAgg(deps.sql, userId, since),
    (async () => {
      const ctx = await getUserSyncContext(deps.sql, userId);
      return reconciledStreak({ sql: deps.sql }, userId, ctx.timezone);
    })(),
  ]);
  // progress.py:63-69: bounded periods only; min 100; 'all' reports 0 —
  // unless the plan floor bounds it anyway (then days = the visible window).
  const days = since === null ? null : Math.max(1, Math.round((now.getTime() - since.getTime()) / 86_400_000));
  const consistencyPct = days === null ? 0 : Math.min(100, Math.round((agg.totalWorkouts / days) * 100));
  return {
    totalWorkouts: agg.totalWorkouts,
    totalKcal: agg.totalKcal,
    totalDurationMs: agg.totalDurationMs,
    avgFormScore: agg.avgFormScore,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    consistencyPct,
    limitedToDays: gate.limitedToDays,
  };
}

export async function progressTrend(
  deps: ReadDeps,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressTrend> {
  const gate = await historyGate(deps, userId);
  const since = clamp(sinceFor(period, new Date()), gate.floor);
  const points = await repo.getDailyTrend(deps.sql, userId, since, await userTz(deps.sql, userId));
  return { points, limitedToDays: gate.limitedToDays };
}

export async function progressWeekly(
  deps: ReadDeps,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressWeekly> {
  const gate = await historyGate(deps, userId);
  const since = clamp(sinceFor(period, new Date()), gate.floor);
  const points = await repo.getWeeklyTrend(deps.sql, userId, since, await userTz(deps.sql, userId));
  return { points, limitedToDays: gate.limitedToDays };
}

/** Last 365 days fixed (progress.py:194), plan-clamped (P2.4). */
export async function progressHeatmap(deps: ReadDeps, userId: string): Promise<ProgressHeatmap> {
  const gate = await historyGate(deps, userId);
  const since = clamp(new Date(Date.now() - 365 * 86_400_000), gate.floor);
  const days = await repo.getDailyTrend(deps.sql, userId, since, await userTz(deps.sql, userId));
  return {
    days: days.map((d) => ({ date: d.date, count: d.workouts, kcal: d.kcal })),
    limitedToDays: gate.limitedToDays,
  };
}

export async function progressDistribution(
  deps: ReadDeps,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressDistribution> {
  const gate = await historyGate(deps, userId);
  const since = clamp(sinceFor(period, new Date()), gate.floor);
  const families = await repo.getFamilyDistribution(deps.sql, userId, since);
  return { families, limitedToDays: gate.limitedToDays };
}

export async function personalRecords(deps: ReadDeps, userId: string): Promise<PersonalRecords> {
  const gate = await historyGate(deps, userId);
  const [records, streak] = await Promise.all([
    repo.getPersonalRecords(deps.sql, userId, gate.floor),
    (async () => {
      const ctx = await getUserSyncContext(deps.sql, userId);
      return reconciledStreak({ sql: deps.sql }, userId, ctx.timezone);
    })(),
  ]);
  // longestStreak stays ungated: streaks are identity, not history reads
  // (Part 7 §3.3 "longest is displayed forever").
  return { ...records, longestStreak: streak.longest, limitedToDays: gate.limitedToDays };
}
