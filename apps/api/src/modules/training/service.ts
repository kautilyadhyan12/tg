// Saving one whole workout from the phone (spec Part 2 §13.5, job 61a). Once its fields have passed
// the shared schema, in one transaction: an id already the person's is answered "duplicate" before
// anything else is asked, so a workout saved once and sent again is never refused later; somebody
// else's id is not found; then its end is checked (a time zone the server cannot use is kept as
// none, never refused); an exercise the Library never had
// refuses the whole save; then the workout and all its sets are written
// together, and only by the request that made the workout. The server works out the calories, the
// heart rate's average and highest, each camera set's form score and the workout's (job 64b-i), and
// (after the commit) the streak and XP from history, which is what makes a second send give nothing
// twice.
import type { Sql } from "postgres";
import { heartSums, setFormScore, trainedMsOf, workoutFormScore, type WorkoutSave } from "@app/shared";
import { onWorkoutSynced } from "../gamification/service.js";
import { getUserSyncContext } from "../users/service.js";
import { KCAL_CALC_VERSION_SAVE, kcalForSave } from "./calories.js";
import * as repo from "./repo.js";

export { ForeignWorkoutError } from "./repo.js";

/** The Library does not know these exercises (422). */
export class UnknownExercisesError extends Error {
  constructor(readonly exercises: readonly string[]) {
    super(`unknown exercises: ${exercises.join(", ")}`);
    this.name = "UnknownExercisesError";
  }
}

/** A save the server refuses for its own facts: a workout that has not ended yet (400). */
export class RefusedSaveError extends Error {
  constructor(readonly problem: "in_the_future") {
    super(problem);
    this.name = "RefusedSaveError";
  }
}

/** How far ahead of the server's clock a phone's clock may be. */
export const FUTURE_SLACK_MS = 5 * 60_000;

export interface SaveDeps {
  sql: Sql;
  now: () => Date;
}

/** The time zone's own name as the server spells it ("asia/kolkata" is "Asia/Calcutta"; "Etc/GMT-3"
 *  stays itself), or null for one the server cannot use: not a zone, or an offset such as "+05:30",
 *  which Postgres reads with the opposite sign. A null zone never refuses a workout: it is kept
 *  without one, and a day is then worked out in the person's own zone. */
export function namedTimeZone(tz: string): string | null {
  let name: string;
  try {
    name = new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return /^[+-]/.test(name) ? null : name;
}

export async function saveWorkout(deps: SaveDeps, userId: string, input: WorkoutSave): Promise<{ status: "created" | "duplicate" }> {
  const ctx = await getUserSyncContext(deps.sql, userId);
  const sets = [...input.sets].sort((a, b) => a.position - b.position);
  const lengthMs = Date.parse(input.endedAt) - Date.parse(input.startedAt);
  const heart = heartSums(input.heart, [], lengthMs);

  const status = await deps.sql.begin(async (tx) => {
    const owner = await repo.workoutOwner(tx, input.workoutId, userId);
    if (owner === "theirs") throw new repo.ForeignWorkoutError();
    if (owner === "mine") return "duplicate" as const;
    if (Date.parse(input.endedAt) > deps.now().getTime() + FUTURE_SLACK_MS) throw new RefusedSaveError("in_the_future");

    await repo.holdLibrary(tx);
    const known = await repo.knownExercises(tx, [...new Set(sets.map((s) => s.exercise))]);
    const unknown = [...new Set(sets.map((s) => s.exercise).filter((slug) => !known.has(slug)))];
    if (unknown.length > 0) throw new UnknownExercisesError(unknown.sort());
    const exerciseOf = (slug: string): repo.KnownExercise => {
      const k = known.get(slug);
      if (k === undefined) throw new Error(`saveWorkout: ${slug} is not known`);
      return k;
    };

    const made = await repo.insertWorkout(tx, {
      id: input.workoutId,
      userId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      platform: input.platform,
      appVersion: input.appVersion,
      setsCount: sets.length,
      totalReps: sets.reduce((sum, s) => sum + (s.measuredIn === "reps" ? s.done : 0), 0),
      // The time trained, never the pauses (64a-ii-b): what Hours Trained, the minutes challenges, goals and the
      // gym's numbers read. The start and end stay the workout's own.
      durationMs: trainedMsOf(input),
      kcalPoint: kcalForSave(
        sets.map((s) => ({ met: exerciseOf(s.exercise).met, durationMs: s.durationMs, done: s.done, restSeconds: s.restSeconds })),
        ctx.weightKg,
        lengthMs,
      ),
      kcalCalcVersion: KCAL_CALC_VERSION_SAVE,
      name: input.name,
      timeZone: namedTimeZone(input.timeZone),
      startedFrom: input.startedFrom,
      effort: input.effort,
      heartAvg: heart?.avg ?? null,
      heartMax: heart?.max ?? null,
      kcalWeightGrams: ctx.weightKg !== null && ctx.weightKg > 0 ? Math.round(ctx.weightKg * 1000) : null,
      // The camera sets' form scores alone (job 64b-i): a set by hand or by timer has none, whatever it carried.
      avgFormScore: workoutFormScore(sets.map((s) => (s.counted === "camera" && s.camera?.summary ? setFormScore(s.camera.summary.repScores) : null))),
    });
    if (!made) {
      // Another request made it between the first question and this insert: it is the person's own
      // (a duplicate) or somebody else's (not found). Its sets are that request's, never this one's.
      if ((await repo.workoutOwner(tx, input.workoutId, userId)) !== "mine") throw new repo.ForeignWorkoutError();
      return "duplicate" as const;
    }
    await repo.insertSets(
      tx,
      input.workoutId,
      userId,
      input.startedAt,
      sets.map((s) => ({ ...s, exerciseId: exerciseOf(s.exercise).exerciseId })),
    );
    return "created" as const;
  });

  // After the commit, whatever the status: a save whose commit succeeded and whose answer was lost is
  // sent again and answered "duplicate", and must still reach the streak and XP. Both are worked out
  // again from history, so running this twice gives nothing twice.
  await onWorkoutSynced({ sql: deps.sql }, userId, ctx.timezone);
  return { status };
}
