// P1.10d — workouts repo: the ONLY file that touches workouts/workout_sets/
// exercises for this module (v1 §6.2, R4.6). Persistence per the Part 4 §3.5
// sync contract: workout inserted ON CONFLICT (id) DO NOTHING, sets upserted
// keyed (workout_id, set_index) — "a retried sync is a no-op by construction;
// no Idempotency-Key bookkeeping table needed for this path."
import type { JSONValue, Sql } from "postgres";
import { type SetMode, setModeSchema } from "@app/shared";
import type { WorkoutSyncPayload } from "./schemas.js";

/** calibration is z.record(z.unknown()) in the shared contract, so TS can't
 *  prove JSON-ness — but every value arrived through a JSON.parse'd HTTP body,
 *  which IS JSONValue by construction (runtime guard for the R2.2 cast:
 *  reject anything that doesn't survive a JSON round-trip). */
function asJsonValue(v: Record<string, unknown>): JSONValue {
  JSON.stringify(v); // throws on circular/BigInt — cannot happen for parsed bodies
  return v as JSONValue;
}

/** The posted workout id already exists and belongs to a DIFFERENT user.
 *  Mapped to 404 (R3.2 — existence of a foreign workout is not revealed). */
export class ForeignWorkoutError extends Error {
  constructor() {
    super("workout does not belong to the authenticated user");
    this.name = "ForeignWorkoutError";
  }
}

export interface SyncOutcome {
  status: "created" | "duplicate";
  /** Sets whose exercise slug has no catalog row (skipped + quality-flagged;
   *  DECISIONS 2026-07-10 — a hard 4xx would park the client's queue). */
  skippedSets: number;
}

export interface ExerciseRef {
  id: string;
  met: number; // Part 4 §3.4; the 2B §2.2 calorie input
}

/** slug -> {id, met} for every distinct slug in the payload. */
export async function getExerciseIdsBySlug(
  sql: Sql,
  slugs: readonly string[],
): Promise<ReadonlyMap<string, ExerciseRef>> {
  if (slugs.length === 0) return new Map();
  const rows = await sql<{ id: string; slug: string; met: string }[]>`
    SELECT id, slug, met FROM exercises WHERE slug = ANY(${[...slugs]})`;
  return new Map(rows.map((r) => [r.slug, { id: r.id, met: Number(r.met) }]));
}

export async function syncWorkout(
  sql: Sql,
  userId: string,
  payload: WorkoutSyncPayload,
  exerciseIdBySlug: ReadonlyMap<string, ExerciseRef>,
  kcal: { point: number; calcVersion: number },
): Promise<SyncOutcome> {
  const known = payload.sets.filter((s) => exerciseIdBySlug.has(s.exercise));
  const skippedSets = payload.sets.length - known.length;

  // Workout-level aggregates derived SERVER-SIDE from the persisted sets
  // (R3.1) — never trusted as separate client fields. kcal computed by the
  // service (2B §2.2 port, P2.3) and stored with its calc version.
  const totalReps = known.reduce((acc, s) => acc + s.reps, 0);
  const durationMs = known.reduce((acc, s) => acc + s.durationMs, 0);
  const scored = known.filter((s) => s.avgFormScore !== null);
  const avgFormScore =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((acc, s) => acc + (s.avgFormScore ?? 0), 0) / scored.length);
  const qualityFlags = skippedSets > 0 ? ["unknown_exercise"] : [];

  return await sql.begin(async (tx) => {
    const inserted = await tx`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version,
                            bundle_version, sets_count, total_reps,
                            avg_form_score, duration_ms, quality_flags,
                            kcal_point, kcal_calc_version)
      VALUES (${payload.workoutId}, ${userId}, ${payload.startedAt},
              ${payload.platform}, ${payload.engineVersion},
              ${payload.defsVersion}, ${known.length}, ${totalReps},
              ${avgFormScore}, ${durationMs}, ${qualityFlags},
              ${kcal.point}, ${kcal.calcVersion})
      ON CONFLICT (id) DO NOTHING`;

    // Ownership is checked AFTER the upsert against the authoritative row, so
    // a concurrent first-insert by another user can never be raced past
    // (check-then-insert would TOCTOU; DO NOTHING + read-back cannot).
    const owner = await tx<{ user_id: string }[]>`
      SELECT user_id FROM workouts WHERE id = ${payload.workoutId}`;
    if (owner[0]?.user_id !== userId) throw new ForeignWorkoutError();

    for (const s of known) {
      const exerciseId = exerciseIdBySlug.get(s.exercise)?.id;
      if (exerciseId === undefined) continue; // unreachable: `known` is pre-filtered
      // A payload that omits `mode` came from a client shipped before the
      // log-only card, and its branch of the union REQUIRES both provenance
      // fields — so 'engine' here is read off the data, not assumed.
      const mode = s.mode ?? "engine";
      // T3 round 1 F5: a `mode === "log_only" ? null : s.repScores` translation
      // used to live here, because the wire demanded `[]` while the column
      // demands NULL. The contract now says NULL too, so the value passes
      // straight through and the two ends cannot drift apart.
      await tx`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at,
                                  set_index, view, mode, reps, hold_ms, duration_ms,
                                  avg_form_score, rep_scores, fault_counts,
                                  tempo_ms_avg, rom_stats, calibration,
                                  engine_version, definition_version)
        VALUES (${payload.workoutId}, ${userId}, ${exerciseId},
                ${payload.startedAt}, ${s.setIndex}, ${s.view}, ${mode}, ${s.reps},
                ${s.holdMs}, ${s.durationMs}, ${s.avgFormScore},
                ${s.repScores}, ${tx.json(asJsonValue(s.faultCounts))}, ${s.tempoMsAvg},
                ${s.romStats === null ? null : tx.json(asJsonValue(s.romStats))},
                ${s.calibration === null ? null : tx.json(asJsonValue(s.calibration))},
                ${s.engineVersion}, ${s.definitionVersion})
        ON CONFLICT (workout_id, set_index) DO NOTHING`;
    }

    return {
      status: inserted.count === 1 ? ("created" as const) : ("duplicate" as const),
      skippedSets,
    };
  });
}

// ── history reads (v1 §6.1 "history, PRs"; Part 4 §3.5 indexes) ─────────────

export interface WorkoutRow {
  id: string;
  startedAt: Date;
  platform: string;
  setsCount: number;
  totalReps: number;
  avgFormScore: number | null;
  durationMs: number | null;
  kcalPoint: number | null;
  kcalCalcVersion: number | null;
  qualityFlags: string[];
  engineVersion: string;
  bundleVersion: number | null;
}

interface WorkoutDbRow {
  id: string;
  started_at: Date;
  platform: string;
  sets_count: number;
  total_reps: number;
  avg_form_score: number | null;
  duration_ms: number | null;
  kcal_point: number | null;
  kcal_calc_version: number | null;
  quality_flags: string[];
  engine_version: string;
  bundle_version: number | null;
}

const toWorkoutRow = (r: WorkoutDbRow): WorkoutRow => ({
  id: r.id,
  startedAt: r.started_at,
  platform: r.platform,
  setsCount: r.sets_count,
  totalReps: r.total_reps,
  avgFormScore: r.avg_form_score,
  durationMs: r.duration_ms,
  kcalPoint: r.kcal_point,
  kcalCalcVersion: r.kcal_calc_version,
  qualityFlags: r.quality_flags,
  engineVersion: r.engine_version,
  bundleVersion: r.bundle_version,
});

/** Keyset page on (started_at, id) DESC — the §3.5 history index order.
 *  Fetches limit+1 (service derives nextCursor). */
export async function listWorkouts(
  sql: Sql,
  userId: string,
  input: {
    limit: number;
    cursor: { startedAt: Date; id: string } | null;
    /** Part 4 §0.2 history read-gate floor (P2.4); null = unlimited. */
    since: Date | null;
  },
): Promise<WorkoutRow[]> {
  const rows = await sql<WorkoutDbRow[]>`
    SELECT id, started_at, platform, sets_count, total_reps, avg_form_score,
           duration_ms, kcal_point, kcal_calc_version, quality_flags,
           engine_version, bundle_version
    FROM workouts
    WHERE user_id = ${userId}
      AND (${input.since === null} OR started_at >= ${input.since})
      AND (${input.cursor === null}
           OR (started_at, id) < (${input.cursor?.startedAt ?? null}, ${input.cursor?.id ?? null}))
    ORDER BY started_at DESC, id DESC
    LIMIT ${input.limit + 1}`;
  return rows.map(toWorkoutRow);
}

export interface SetRow {
  setIndex: number;
  exerciseSlug: string;
  view: string | null;
  reps: number;
  holdMs: number | null;
  durationMs: number;
  avgFormScore: number | null;
  repScores: number[] | null;
  faultCounts: unknown;
  tempoMsAvg: number | null;
  romStats: unknown;
  mode: SetMode | null;
  engineVersion: string | null;
  definitionVersion: number | null;
}

/** The stored `mode` text, validated into the union — or null for "unknown".
 *  A value the CHECK constraint should have made impossible is treated as
 *  unknown rather than passed through: the read path must not be the place an
 *  unrecognised kind first reaches a screen. */
function toSetMode(v: string | null): SetMode | null {
  const parsed = setModeSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

/** Detail keyed (id, userId) — a foreign id reads as absent (R3.2). */
export async function getWorkoutDetail(
  sql: Sql,
  userId: string,
  workoutId: string,
): Promise<{ workout: WorkoutRow; sets: SetRow[] } | null> {
  const rows = await sql<WorkoutDbRow[]>`
    SELECT id, started_at, platform, sets_count, total_reps, avg_form_score,
           duration_ms, kcal_point, kcal_calc_version, quality_flags,
           engine_version, bundle_version
    FROM workouts WHERE id = ${workoutId} AND user_id = ${userId}`;
  const w = rows[0];
  if (w === undefined) return null;
  const sets = await sql<
    {
      set_index: number;
      slug: string;
      view: string | null;
      reps: number;
      hold_ms: number | null;
      duration_ms: number;
      avg_form_score: number | null;
      rep_scores: number[] | null;
      fault_counts: unknown;
      tempo_ms_avg: number | null;
      rom_stats: unknown;
      mode: string | null;
      engine_version: string | null;
      definition_version: number | null;
    }[]
  >`
    SELECT s.set_index, e.slug, s.view, s.mode, s.reps, s.hold_ms, s.duration_ms,
           s.avg_form_score, s.rep_scores, s.fault_counts, s.tempo_ms_avg,
           s.rom_stats, s.engine_version, s.definition_version
    FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
    WHERE s.workout_id = ${workoutId} AND s.user_id = ${userId}
    ORDER BY s.set_index ASC`;
  return {
    workout: toWorkoutRow(w),
    sets: sets.map((s) => ({
      setIndex: s.set_index,
      exerciseSlug: s.slug,
      view: s.view,
      reps: s.reps,
      holdMs: s.hold_ms,
      durationMs: s.duration_ms,
      avgFormScore: s.avg_form_score,
      // `?? []` WOULD BE A FABRICATION HERE now that null is meaningful: a
      // log-only set has no rep scores because nothing scored it, and an empty
      // array claims a scoring pass that found none. Passed through as null.
      repScores: s.rep_scores,
      faultCounts: s.fault_counts,
      tempoMsAvg: s.tempo_ms_avg,
      romStats: s.rom_stats,
      mode: toSetMode(s.mode),
      engineVersion: s.engine_version,
      definitionVersion: s.definition_version,
    })),
  };
}

// ── progress aggregates (progress.py ports; day/hour buckets in the user's
//    timezone — Part 7 §3.1 rule, DECISIONS P2.3 GAP-3; timeZone is a
//    safeTimeZone-validated IANA name, always a parameterized VALUE) ────────

export interface OverviewAgg {
  totalWorkouts: number;
  totalKcal: number;
  totalDurationMs: number;
  avgFormScore: number | null;
}

export async function getOverviewAgg(
  sql: Sql,
  userId: string,
  since: Date | null,
): Promise<OverviewAgg> {
  const [r] = await sql<
    { n: string; kcal: string; dur: string; form: string | null }[]
  >`
    SELECT count(*) AS n, coalesce(sum(kcal_point), 0) AS kcal,
           coalesce(sum(duration_ms), 0) AS dur, avg(avg_form_score) AS form
    FROM workouts
    WHERE user_id = ${userId} AND (${since === null} OR started_at >= ${since})`;
  return {
    totalWorkouts: Number(r?.n ?? 0),
    totalKcal: Number(r?.kcal ?? 0),
    totalDurationMs: Number(r?.dur ?? 0),
    avgFormScore: r?.form == null ? null : Math.round(Number(r.form)),
  };
}

export async function getDailyTrend(
  sql: Sql,
  userId: string,
  since: Date | null,
  timeZone: string,
): Promise<{ date: string; kcal: number; workouts: number }[]> {
  const rows = await sql<{ day: string; kcal: string; n: string }[]>`
    SELECT to_char(started_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
           coalesce(sum(kcal_point), 0) AS kcal, count(*) AS n
    FROM workouts
    WHERE user_id = ${userId} AND (${since === null} OR started_at >= ${since})
    GROUP BY day ORDER BY day ASC`;
  return rows.map((r) => ({ date: r.day, kcal: Number(r.kcal), workouts: Number(r.n) }));
}

export async function getWeeklyTrend(
  sql: Sql,
  userId: string,
  since: Date | null,
  timeZone: string,
): Promise<{ isoYear: number; isoWeek: number; workouts: number; kcal: number }[]> {
  const rows = await sql<{ iso_year: string; iso_week: string; n: string; kcal: string }[]>`
    SELECT extract(isoyear FROM started_at AT TIME ZONE ${timeZone}) AS iso_year,
           extract(week FROM started_at AT TIME ZONE ${timeZone}) AS iso_week,
           count(*) AS n, coalesce(sum(kcal_point), 0) AS kcal
    FROM workouts
    WHERE user_id = ${userId} AND (${since === null} OR started_at >= ${since})
    GROUP BY iso_year, iso_week ORDER BY iso_year ASC, iso_week ASC`;
  return rows.map((r) => ({
    isoYear: Number(r.iso_year),
    isoWeek: Number(r.iso_week),
    workouts: Number(r.n),
    kcal: Number(r.kcal),
  }));
}

export async function getFamilyDistribution(
  sql: Sql,
  userId: string,
  since: Date | null,
): Promise<{ family: string; sets: number }[]> {
  const rows = await sql<{ family: string; n: string }[]>`
    SELECT e.family, count(*) AS n
    FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id
    WHERE s.user_id = ${userId} AND (${since === null} OR s.started_at >= ${since})
    GROUP BY e.family ORDER BY n DESC, e.family ASC`;
  return rows.map((r) => ({ family: r.family, sets: Number(r.n) }));
}

export interface RecordRef {
  workoutId: string;
  value: number;
}

async function topWorkoutBy(
  sql: Sql,
  userId: string,
  column: "kcal_point" | "duration_ms" | "avg_form_score",
  since: Date | null,
): Promise<RecordRef | null> {
  // Fixed column set — identifiers never come from input (R3.8).
  const rows =
    column === "kcal_point"
      ? await sql<{ id: string; v: number | null }[]>`
          SELECT id, kcal_point AS v FROM workouts
          WHERE user_id = ${userId} AND kcal_point IS NOT NULL
            AND (${since === null} OR started_at >= ${since})
          ORDER BY kcal_point DESC, started_at DESC LIMIT 1`
      : column === "duration_ms"
        ? await sql<{ id: string; v: number | null }[]>`
            SELECT id, duration_ms AS v FROM workouts
            WHERE user_id = ${userId} AND duration_ms IS NOT NULL
              AND (${since === null} OR started_at >= ${since})
            ORDER BY duration_ms DESC, started_at DESC LIMIT 1`
        : await sql<{ id: string; v: number | null }[]>`
            SELECT id, avg_form_score AS v FROM workouts
            WHERE user_id = ${userId} AND avg_form_score IS NOT NULL
              AND (${since === null} OR started_at >= ${since})
            ORDER BY avg_form_score DESC, started_at DESC LIMIT 1`;
  const r = rows[0];
  return r === undefined || r.v === null ? null : { workoutId: r.id, value: r.v };
}

export async function getPersonalRecords(
  sql: Sql,
  userId: string,
  since: Date | null,
): Promise<{
  maxKcalWorkout: RecordRef | null;
  longestWorkout: RecordRef | null;
  bestAvgForm: RecordRef | null;
  totalWorkouts: number;
}> {
  const [maxKcalWorkout, longestWorkout, bestAvgForm, count] = await Promise.all([
    topWorkoutBy(sql, userId, "kcal_point", since),
    topWorkoutBy(sql, userId, "duration_ms", since),
    topWorkoutBy(sql, userId, "avg_form_score", since),
    sql<{ n: string }[]>`
      SELECT count(*) AS n FROM workouts
      WHERE user_id = ${userId} AND (${since === null} OR started_at >= ${since})`,
  ]);
  return { maxKcalWorkout, longestWorkout, bestAvgForm, totalWorkouts: Number(count[0]?.n ?? 0) };
}
