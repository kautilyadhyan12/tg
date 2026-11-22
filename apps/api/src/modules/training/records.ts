// The records of one exercise, worked out from its sets when they are read (spec Part 2 §13.5, job
// 61b). Pure: the same sets in, the same records out. The ONE rule for both the records of an exercise
// and the "New record" of a workout, so the two never disagree.
//
// - A set with nothing done is no record of any kind.
// - A set is read in its own unit: a set done in reps never counts towards a hold, nor one in time
//   towards most reps, whatever the exercise is measured in today.
// - Heaviest is the heaviest weight of a set that was done; most reps the most reps in one set; best
//   estimated one-rep max is Epley's formula over sets of 1 to 10 reps with a weight; longest hold the
//   longest set in time; most lifted the weight times the reps of all of one workout's sets.
// - On a tie the first time it was reached keeps the record.
// - "New record" is a set (or, for most lifted, a workout) that beats everything the person did BEFORE
//   that workout. With nothing of that kind before it, nothing is beaten: the first is not a record.
import { estimatedOneRepMaxGrams, type ExerciseRecords, type NewRecord, type RecentWorkout, type RecordKind, type RecordSet } from "@app/shared";

/** One set, as the records read it. */
export interface SetFact {
  workoutId: string;
  /** The workout's start, an ISO instant. */
  startedAt: string;
  exercise: string;
  position: number;
  measuredIn: "reps" | "time";
  /** Reps, or whole seconds for a set in time. */
  done: number;
  weightGrams: number | null;
}

/** What one workout lifted of one exercise: the weight times the reps of its sets in reps. */
export interface LiftedWorkout {
  workoutId: string;
  startedAt: string;
  exercise: string;
  grams: number;
}

/** What each workout lifted, worked out from all of its sets. */
export function liftedOf(sets: readonly SetFact[]): LiftedWorkout[] {
  const sums = new Map<string, LiftedWorkout>();
  for (const s of sets) {
    if (s.measuredIn !== "reps" || s.weightGrams === null || s.done <= 0) continue;
    const key = `${s.workoutId}|${s.exercise}`;
    const sum = sums.get(key) ?? { workoutId: s.workoutId, startedAt: s.startedAt, exercise: s.exercise, grams: 0 };
    sum.grams += s.weightGrams * s.done;
    sums.set(key, sum);
  }
  return [...sums.values()];
}

// Epley's estimate is shared, so the phone names a record's value by the same formula (64a-v).
export { EPLEY_REPS_MOST, estimatedOneRepMaxGrams } from "@app/shared";

/** A set's unit and what was done, from the row as kept. A set saved by the old route has no unit kept:
 *  one with a hold is in time, any other in reps. Time is in whole seconds, rounded down. */
export function unitAndDone(measuredIn: string | null, reps: number, holdMs: number | null): { measuredIn: "reps" | "time"; done: number } {
  const unit = measuredIn === "reps" || measuredIn === "time" ? measuredIn : holdMs !== null ? "time" : "reps";
  return { measuredIn: unit, done: unit === "time" ? Math.floor((holdMs ?? 0) / 1000) : reps };
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Earliest first: by the workout's start, then the workout's id, then the set's place. */
function inOrder<T extends { startedAt: string; workoutId: string; position?: number }>(rows: readonly T[]): T[] {
  return rows
    .map((r) => ({ r, at: Date.parse(r.startedAt) }))
    .sort((a, b) => a.at - b.at || byId(a.r.workoutId, b.r.workoutId) || (a.r.position ?? 0) - (b.r.position ?? 0))
    .map((x) => x.r);
}

const asRecord = (s: SetFact): RecordSet => ({ workoutId: s.workoutId, startedAt: s.startedAt, position: s.position, done: s.done, weightGrams: s.weightGrams });

type Records = Omit<ExerciseRecords, "exercise" | "limitedToDays" | "recent" | "days">;

/** The records of ONE exercise. `sets` may be all its sets, or only the first of each set done the same
 *  way (`historyRepo.ts` recordCandidates): the records of a set come out the same. `lifted` is what each
 *  workout lifted of it, worked out from all of its sets. */
export function exerciseRecords(sets: readonly SetFact[], lifted: readonly LiftedWorkout[] = liftedOf(sets)): Records {
  let heaviest: SetFact | null = null;
  let mostReps: SetFact | null = null;
  let best1rm: { set: SetFact; estimate: number } | null = null;
  let longestHold: SetFact | null = null;
  let heaviestHold: SetFact | null = null;
  for (const s of inOrder(sets)) {
    if (s.done <= 0) continue;
    if (s.measuredIn === "reps") {
      if (s.weightGrams !== null && (heaviest === null || s.weightGrams > (heaviest.weightGrams ?? 0))) heaviest = s;
      if (mostReps === null || s.done > mostReps.done) mostReps = s;
      const estimate = estimatedOneRepMaxGrams(s.weightGrams, s.done);
      if (estimate !== null && (best1rm === null || estimate > best1rm.estimate)) best1rm = { set: s, estimate };
    } else {
      if (longestHold === null || s.done > longestHold.done) longestHold = s;
      if (s.weightGrams !== null && (heaviestHold === null || s.weightGrams > (heaviestHold.weightGrams ?? 0))) heaviestHold = s;
    }
  }

  let mostLifted: { workoutId: string; startedAt: string; grams: number } | null = null;
  for (const w of inOrder(lifted)) {
    if (w.grams > 0 && (mostLifted === null || w.grams > mostLifted.grams)) mostLifted = { workoutId: w.workoutId, startedAt: w.startedAt, grams: w.grams };
  }

  return {
    reps: {
      heaviest: heaviest === null ? null : asRecord(heaviest),
      mostReps: mostReps === null ? null : asRecord(mostReps),
      bestEstimated1rm: best1rm === null ? null : { ...asRecord(best1rm.set), estimateGrams: best1rm.estimate },
      mostLifted,
    },
    time: {
      longestHold: longestHold === null ? null : asRecord(longestHold),
      heaviest: heaviestHold === null ? null : asRecord(heaviestHold),
    },
  };
}

interface Told {
  kind: RecordKind;
  measuredIn: "reps" | "time";
  value: number | null;
  position: number | null;
}

/** Each kind of record a set of records holds, with its value and the set that made it. */
function told(r: Records): Told[] {
  const b = r.reps.bestEstimated1rm;
  return [
    { kind: "heaviest", measuredIn: "reps", value: r.reps.heaviest?.weightGrams ?? null, position: r.reps.heaviest?.position ?? null },
    { kind: "most_reps", measuredIn: "reps", value: r.reps.mostReps?.done ?? null, position: r.reps.mostReps?.position ?? null },
    { kind: "best_estimated_1rm", measuredIn: "reps", value: b?.estimateGrams ?? null, position: b?.position ?? null },
    { kind: "most_lifted", measuredIn: "reps", value: r.reps.mostLifted?.grams ?? null, position: null },
    { kind: "longest_hold", measuredIn: "time", value: r.time.longestHold?.done ?? null, position: r.time.longestHold?.position ?? null },
    { kind: "heaviest", measuredIn: "time", value: r.time.heaviest?.weightGrams ?? null, position: r.time.heaviest?.position ?? null },
  ];
}

/** The new records of one workout: `workout` is all its sets; `before` the sets of the same exercises the
 *  person did in workouts before it (all of them, or the first of each done the same way), and
 *  `beforeLifted` what each of those workouts lifted. In the order the workout first did each exercise. */
export function newRecordsIn(workout: readonly SetFact[], before: readonly SetFact[], beforeLifted: readonly LiftedWorkout[] = liftedOf(before)): NewRecord[] {
  const exercises: string[] = [];
  for (const s of [...workout].sort((a, b) => a.position - b.position)) if (!exercises.includes(s.exercise)) exercises.push(s.exercise);

  const out: NewRecord[] = [];
  for (const exercise of exercises) {
    const now = told(exerciseRecords(workout.filter((s) => s.exercise === exercise)));
    const then = told(exerciseRecords(before.filter((s) => s.exercise === exercise), beforeLifted.filter((l) => l.exercise === exercise)));
    now.forEach((n, i) => {
      const t = then[i]?.value ?? null;
      if (n.value !== null && t !== null && n.value > t) out.push({ exercise, measuredIn: n.measuredIn, kind: n.kind, position: n.position });
    });
  }
  return out;
}

/** Every workout the records and the latest workouts name, each once. */
export function namedWorkouts(r: Records, recent: readonly RecentWorkout[]): string[] {
  const sets = [r.reps.heaviest, r.reps.mostReps, r.reps.bestEstimated1rm, r.reps.mostLifted, r.time.longestHold, r.time.heaviest];
  return [...new Set([...sets.flatMap((x) => (x === null ? [] : [x.workoutId])), ...recent.map((w) => w.workoutId)])];
}

/** Each workout's own best of each kind, by the same reading as the records (a set with nothing done
 *  counts for nothing; a set in its own unit), the earliest workout first. A workout with nothing done is
 *  left out. `sets` are those of ONE exercise. */
export function recentBests(sets: readonly SetFact[]): RecentWorkout[] {
  const out = new Map<string, RecentWorkout>();
  const most = (a: number | null, b: number | null): number | null => (b === null ? a : a === null || b > a ? b : a);
  for (const s of inOrder(sets)) {
    if (s.done <= 0) continue;
    const w = out.get(s.workoutId) ?? { workoutId: s.workoutId, startedAt: s.startedAt, reps: { heaviestGrams: null, mostReps: null }, time: { longestHold: null, heaviestGrams: null } };
    if (s.measuredIn === "reps") {
      w.reps.heaviestGrams = most(w.reps.heaviestGrams, s.weightGrams);
      w.reps.mostReps = most(w.reps.mostReps, s.done);
    } else {
      w.time.longestHold = most(w.time.longestHold, s.done);
      w.time.heaviestGrams = most(w.time.heaviestGrams, s.weightGrams);
    }
    out.set(s.workoutId, w);
  }
  return [...out.values()];
}
