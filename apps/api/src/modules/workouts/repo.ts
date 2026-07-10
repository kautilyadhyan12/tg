// P1.10d — workouts repo: the ONLY file that touches workouts/workout_sets/
// exercises for this module (v1 §6.2, R4.6). Persistence per the Part 4 §3.5
// sync contract: workout inserted ON CONFLICT (id) DO NOTHING, sets upserted
// keyed (workout_id, set_index) — "a retried sync is a no-op by construction;
// no Idempotency-Key bookkeeping table needed for this path."
import type { JSONValue, Sql } from "postgres";
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

/** slug -> exercises.id for every distinct slug in the payload. */
export async function getExerciseIdsBySlug(
  sql: Sql,
  slugs: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM exercises WHERE slug = ANY(${[...slugs]})`;
  return new Map(rows.map((r) => [r.slug, r.id]));
}

export async function syncWorkout(
  sql: Sql,
  userId: string,
  payload: WorkoutSyncPayload,
  exerciseIdBySlug: ReadonlyMap<string, string>,
): Promise<SyncOutcome> {
  const known = payload.sets.filter((s) => exerciseIdBySlug.has(s.exercise));
  const skippedSets = payload.sets.length - known.length;

  // Workout-level aggregates derived SERVER-SIDE from the persisted sets
  // (R3.1) — never trusted as separate client fields. kcal_point /
  // kcal_calc_version stay null until the 2B §2.2 port (DECISIONS 2026-07-10).
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
                            avg_form_score, duration_ms, quality_flags)
      VALUES (${payload.workoutId}, ${userId}, ${payload.startedAt},
              ${payload.platform}, ${payload.engineVersion},
              ${payload.defsVersion}, ${known.length}, ${totalReps},
              ${avgFormScore}, ${durationMs}, ${qualityFlags})
      ON CONFLICT (id) DO NOTHING`;

    // Ownership is checked AFTER the upsert against the authoritative row, so
    // a concurrent first-insert by another user can never be raced past
    // (check-then-insert would TOCTOU; DO NOTHING + read-back cannot).
    const owner = await tx<{ user_id: string }[]>`
      SELECT user_id FROM workouts WHERE id = ${payload.workoutId}`;
    if (owner[0]?.user_id !== userId) throw new ForeignWorkoutError();

    for (const s of known) {
      const exerciseId = exerciseIdBySlug.get(s.exercise);
      if (exerciseId === undefined) continue; // unreachable: `known` is pre-filtered
      await tx`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at,
                                  set_index, view, reps, hold_ms, duration_ms,
                                  avg_form_score, rep_scores, fault_counts,
                                  tempo_ms_avg, rom_stats, calibration,
                                  engine_version, definition_version)
        VALUES (${payload.workoutId}, ${userId}, ${exerciseId},
                ${payload.startedAt}, ${s.setIndex}, ${s.view}, ${s.reps},
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
