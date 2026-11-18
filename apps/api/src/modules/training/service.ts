// Saving one whole workout from the phone (spec Part 2 §13.5, job 61a). Once its fields have passed
// the shared schema, in one transaction: an id already the person's is answered "duplicate" before
// anything else is asked, so a workout saved once and sent again is never refused later; somebody
// else's id is not found; then its time zone and end are checked; an exercise the Library never had
// refuses the whole save; then the workout and all its sets are written
// together, and only by the request that made the workout. The server works out the calories, the
// heart rate's average and highest, and (after the commit) the streak and XP from history, which is
// what makes a second send give nothing twice.
import type { Sql } from "postgres";
import { heartSums, type WorkoutSave } from "@app/shared";
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

/** A save the server refuses for its own facts: a time zone that is not one, or a workout that has
 *  not happened yet (400). */
export class RefusedSaveError extends Error {
  constructor(readonly problem: "time_zone" | "in_the_future") {
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

/** The time zone's own name as the server's time zone list spells it ("asia/kolkata" is
 *  "Asia/Calcutta"), or null for one that is not a named zone. An offset such as "+05:30" is refused:
 *  Postgres reads it with the opposite sign, so a day worked out from it would be the wrong day. */
export function namedTimeZone(tz: string): string | null {
  let name: string;
  try {
    name = new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return name === "UTC" || Intl.supportedValuesOf("timeZone").includes(name) ? name : null;
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
    const timeZone = namedTimeZone(input.timeZone);
    if (timeZone === null) throw new RefusedSaveError("time_zone");
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
      durationMs: lengthMs,
      kcalPoint: kcalForSave(
        sets.map((s) => ({ met: exerciseOf(s.exercise).met, durationMs: s.durationMs, done: s.done, restSeconds: s.restSeconds })),
        ctx.weightKg,
        lengthMs,
      ),
      kcalCalcVersion: KCAL_CALC_VERSION_SAVE,
      name: input.name,
      timeZone,
      startedFrom: input.startedFrom,
      effort: input.effort,
      heartAvg: heart?.avg ?? null,
      heartMax: heart?.max ?? null,
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
