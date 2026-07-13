// P2.7c — workouts stage. Transforms a legacy `workout_sessions` doc into one
// `workouts` row plus its unrolled `workout_sets` rows, and inserts them
// idempotently. The legacy `exercises[]` items are PRESCRIPTIONS
// {id,name,category?,sets,reps,rest} — 0/230 carry per-set performance
// (DATA-VERIFIED, INVENTORY.md §2) — so the unroll expands each item's `sets`
// count into set_index rows with the prescribed `reps`, and every rich engine
// column (view/mode/hold/scores/tempo/rom/calibration) is NULL. Field contract
// mirrors modules/workouts/repo.ts syncWorkout (:50-116).
import { z } from "zod";
import type { Sql } from "postgres";
import { uuidv5 } from "../uuid5.js";
import { NAME_TO_SLUG } from "../exerciseNames.js";

// Boundary parse (R2.3) — only the fields the transform reads. `_id` and
// `user_id` arrive as reader-normalized hex strings (mongo.ts). Lenient:
// numbers may be absent/null; unknown keys pass through.
const legacyItemSchema = z
  .object({
    name: z.string(),
    sets: z.number().nullish(),
    reps: z.number().nullish(),
  })
  .passthrough();

const legacySessionSchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    exercises: z.array(z.unknown()).nullish(),
    calories_burned: z.number().nullish(),
    duration_minutes: z.number().nullish(),
    form_accuracy: z.number().nullish(),
    started_at: z.union([z.date(), z.string()]).nullish(),
    completed_at: z.union([z.date(), z.string()]).nullish(),
  })
  .passthrough();

/** Legacy timestamp → Date, or null when unparseable (an Invalid Date would
 *  abort the insert — same guard as the users stage, T3 finding 3). */
function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A prescribed count → a non-negative integer set/rep count (legacy stores
 *  numbers; guard against floats/negatives). */
function toCount(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return 0;
  return Math.trunc(v);
}

export interface WorkoutSetRow {
  id: string;
  exerciseId: string;
  setIndex: number; // GLOBAL 0..n-1 across the whole workout (Kd ruling)
  reps: number;
}

export interface WorkoutRow {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  avgFormScore: number | null;
  durationMs: number | null;
  kcalPoint: number | null;
  // 0 = legacy keep-stored. DEVIATION from §7's calc_version=1 recompute: the
  // MET input (active_seconds_by_exercise) was never persisted, so a recompute
  // would zero out every workout — G-kcal ruling, DECISIONS 2026-07-13 (T3-A).
  kcalCalcVersion: number;
  setsCount: number;
  totalReps: number;
  qualityFlags: string[];
  sets: WorkoutSetRow[];
  /** Prescribed sets dropped because the exercise name has no seeded slug. */
  skippedSets: number;
}

/** Pure transform — null when the doc is too malformed to migrate (missing
 *  `started_at`, which is NOT NULL; caller logs + counts skipped). `idBySlug`
 *  is slug→exercises.id for the SEEDED catalog; a name whose slug is absent is
 *  skipped + flagged (GAP1=a). Picking it up after P4 needs a CLEAN re-migrate,
 *  not an incremental re-run (T3-B; see exerciseNames.ts / DECISIONS). */
export function transformWorkout(
  doc: unknown,
  idBySlug: ReadonlyMap<string, string>,
): WorkoutRow | null {
  const parsed = legacySessionSchema.safeParse(doc);
  if (!parsed.success) return null;
  const s = parsed.data;

  const startedAt = toDate(s.started_at);
  if (startedAt === null) return null; // workouts.started_at is NOT NULL

  const sets: WorkoutSetRow[] = [];
  let skippedSets = 0;
  let totalReps = 0;
  const items = s.exercises ?? [];
  for (const raw of items) {
    const item = legacyItemSchema.safeParse(raw);
    if (!item.success) continue; // a malformed item is not a countable prescription
    const count = toCount(item.data.sets);
    const reps = toCount(item.data.reps);
    const slug = NAME_TO_SLUG[item.data.name];
    const exerciseId = slug === undefined ? undefined : idBySlug.get(slug);
    if (exerciseId === undefined) {
      skippedSets += count; // unresolved (unmapped name, or slug not seeded today)
      continue;
    }
    for (let i = 0; i < count; i += 1) {
      const setIndex = sets.length; // global index across the workout
      sets.push({ id: uuidv5(`${s._id}:${String(setIndex)}`), exerciseId, setIndex, reps });
      totalReps += reps;
    }
  }

  return {
    id: uuidv5(s._id),
    userId: uuidv5(s.user_id),
    startedAt,
    endedAt: toDate(s.completed_at),
    avgFormScore: s.form_accuracy == null ? null : Math.round(s.form_accuracy),
    durationMs: s.duration_minutes == null ? null : Math.round(s.duration_minutes * 60_000),
    kcalPoint: s.calories_burned == null ? null : Math.round(s.calories_burned),
    kcalCalcVersion: 0,
    setsCount: sets.length,
    totalReps,
    qualityFlags: skippedSets > 0 ? ["unknown_exercise"] : [],
    sets,
    skippedSets,
  };
}

export interface InsertOutcome {
  workoutInserted: number; // 0 on a re-run (ON CONFLICT (id) DO NOTHING)
  setsInserted: number; // 0 on a re-run (ON CONFLICT (workout_id, set_index))
}

/** Idempotent insert of one workout + its sets in a single transaction
 *  (mirrors syncWorkout). Re-runs are no-ops by construction: the workout PK is
 *  the deterministic UUIDv5(sessionHex) and sets are keyed (workout_id,
 *  set_index). Fixed columns: platform='web', engine_version='legacy-py',
 *  bundle_version=0, definition_version=0, duration_ms=0 per set (GAP2). */
export async function insertWorkout(sql: Sql, r: WorkoutRow): Promise<InsertOutcome> {
  return await sql.begin(async (tx) => {
    const ins = await tx`
      INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version,
                            bundle_version, sets_count, total_reps, avg_form_score,
                            duration_ms, kcal_point, kcal_calc_version, quality_flags)
      VALUES (${r.id}, ${r.userId}, ${r.startedAt}, ${r.endedAt}, 'web', 'legacy-py',
              0, ${r.setsCount}, ${r.totalReps}, ${r.avgFormScore},
              ${r.durationMs}, ${r.kcalPoint}, ${r.kcalCalcVersion}, ${r.qualityFlags})
      ON CONFLICT (id) DO NOTHING`;
    let setsInserted = 0;
    for (const s of r.sets) {
      const res = await tx`
        INSERT INTO workout_sets (id, workout_id, user_id, exercise_id, started_at,
                                  set_index, reps, duration_ms, engine_version,
                                  definition_version)
        VALUES (${s.id}, ${r.id}, ${r.userId}, ${s.exerciseId}, ${r.startedAt},
                ${s.setIndex}, ${s.reps}, 0, 'legacy-py', 0)
        ON CONFLICT (workout_id, set_index) DO NOTHING`;
      setsInserted += res.count;
    }
    return { workoutInserted: ins.count, setsInserted };
  });
}

/** slug→exercises.id for every slug named in the 14-name map that has a SEEDED
 *  catalog row (today: squat/jump_squat/chair_squat). Unmapped slugs simply do
 *  not appear, so the transform skips their sets. */
export async function loadExerciseIds(sql: Sql): Promise<ReadonlyMap<string, string>> {
  const slugs = [...new Set(Object.values(NAME_TO_SLUG))];
  const rows = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM exercises WHERE slug = ANY(${slugs})`;
  return new Map(rows.map((row) => [row.slug, row.id]));
}
