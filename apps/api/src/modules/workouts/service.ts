// P1.10d/P2.3 — workouts service: orchestration between route and repo
// (v1 §6.2). P2.3 adds: kcal at sync (2B §2.2), the gamification hook
// (cross-module via service interface, R7.1), history pages, and the
// progress.py ports. Retry-safety (R3.5): everything behind a duplicate
// sync is either keyed-idempotent or skipped on status==='duplicate'.
import type { Sql } from "postgres";
import {
  onWorkoutSynced,
  reconciledStreak,
} from "../gamification/service.js";
import { safeTimeZone } from "../gamification/streak.js";
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

  // Gamification only on first persistence: a retried sync must not
  // re-register activity or re-run awards (they're idempotent anyway —
  // belt and braces).
  if (outcome.status === "created") {
    await onWorkoutSynced({ sql }, userId, new Date(payload.startedAt), ctx.timezone);
  }

  return { workoutId: payload.workoutId, status: outcome.status, skippedSets: outcome.skippedSets };
}

// ── history ──────────────────────────────────────────────────────────────────

/** Opaque-ish cursor: `<startedAt ISO>|<uuid>`. Malformed → null (treated as
 *  first page — never a 500 from a hand-edited cursor). */
function parseCursor(cursor: string | undefined): { startedAt: Date; id: string } | null {
  if (cursor === undefined) return null;
  const sep = cursor.indexOf("|");
  if (sep === -1) return null;
  const startedAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(startedAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { startedAt, id };
}

const toListItem = (w: repo.WorkoutRow) => ({
  id: w.id,
  startedAt: w.startedAt.toISOString(),
  platform: w.platform as "web" | "android" | "ios", // CHECK-constrained (Part 4 §3.5)
  setsCount: w.setsCount,
  totalReps: w.totalReps,
  avgFormScore: w.avgFormScore,
  durationMs: w.durationMs,
  kcalPoint: w.kcalPoint,
  kcalCalcVersion: w.kcalCalcVersion,
  qualityFlags: w.qualityFlags,
});

export async function listWorkouts(
  sql: Sql,
  userId: string,
  query: WorkoutListQuery,
): Promise<WorkoutPage> {
  const rows = await repo.listWorkouts(sql, userId, {
    limit: query.limit,
    cursor: parseCursor(query.cursor),
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map(toListItem),
    nextCursor: hasMore && last !== undefined ? `${last.startedAt.toISOString()}|${last.id}` : null,
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
      engineVersion: s.engineVersion,
      definitionVersion: s.definitionVersion,
    })),
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
  sql: Sql,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressOverview> {
  const now = new Date();
  const since = sinceFor(period, now);
  const [agg, streak] = await Promise.all([
    repo.getOverviewAgg(sql, userId, since),
    (async () => {
      const ctx = await getUserSyncContext(sql, userId);
      return reconciledStreak({ sql }, userId, ctx.timezone);
    })(),
  ]);
  // progress.py:63-69: bounded periods only; min 100; 'all' reports 0.
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
  };
}

export async function progressTrend(
  sql: Sql,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressTrend> {
  const points = await repo.getDailyTrend(sql, userId, sinceFor(period, new Date()), await userTz(sql, userId));
  return { points };
}

export async function progressWeekly(
  sql: Sql,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressWeekly> {
  const points = await repo.getWeeklyTrend(sql, userId, sinceFor(period, new Date()), await userTz(sql, userId));
  return { points };
}

/** Last 365 days fixed (progress.py:194). */
export async function progressHeatmap(sql: Sql, userId: string): Promise<ProgressHeatmap> {
  const since = new Date(Date.now() - 365 * 86_400_000);
  const days = await repo.getDailyTrend(sql, userId, since, await userTz(sql, userId));
  return { days: days.map((d) => ({ date: d.date, count: d.workouts, kcal: d.kcal })) };
}

export async function progressDistribution(
  sql: Sql,
  userId: string,
  period: ProgressPeriod,
): Promise<ProgressDistribution> {
  const families = await repo.getFamilyDistribution(sql, userId, sinceFor(period, new Date()));
  return { families };
}

export async function personalRecords(sql: Sql, userId: string): Promise<PersonalRecords> {
  const [records, streak] = await Promise.all([
    repo.getPersonalRecords(sql, userId),
    (async () => {
      const ctx = await getUserSyncContext(sql, userId);
      return reconciledStreak({ sql }, userId, ctx.timezone);
    })(),
  ]);
  return { ...records, longestStreak: streak.longest };
}
