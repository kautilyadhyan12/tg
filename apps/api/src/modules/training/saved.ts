// A person's saved workouts (spec Part 2 §13.5, job 61c): list, read one, save (or save a change), delete.
// A save is one transaction under the Library's publish lock held shared (a publish asks whether a saved
// workout names an exercise before it removes it) and the person's own lock (so two new ones at the same
// instant cannot both pass the limit). In it: somebody else's id is not found; an id the person deleted
// keeps nothing; a change older than the one kept keeps nothing; an exercise the Library never had refuses
// the save; a new one past the limit is refused; then the saved workout and all its sets are written.
import { PLANNED_WORKOUT_LIMITS, plannedExerciseSchema, type SavedWorkout, type SavedWorkoutList, type SavedWorkoutWrite } from "@app/shared";
import type { Sql } from "postgres";
import { z } from "zod";
import { holdLibrary, knownExercises } from "./repo.js";
import * as repo from "./savedRepo.js";
import { FUTURE_SLACK_MS, UnknownExercisesError } from "./service.js";

/** The id is somebody else's saved workout (404, as an id that does not exist is to a read). */
export class ForeignSavedError extends Error {
  constructor() {
    super("saved workout does not belong to the authenticated user");
    this.name = "ForeignSavedError";
  }
}

/** A new saved workout past the person's limit (409). */
export class SavedFullError extends Error {
  constructor() {
    super("saved workouts full");
    this.name = "SavedFullError";
  }
}

/** A change made later than the server's clock allows (400): kept, it would outrank every later change. */
export class FutureEditError extends Error {
  constructor() {
    super("editedAt is in the future");
    this.name = "FutureEditError";
  }
}

export interface SavedDeps {
  sql: Sql;
  now: () => Date;
}

export type SavedStatus = "created" | "updated" | "unchanged" | "removed";

export async function writeSaved(deps: SavedDeps, userId: string, id: string, input: SavedWorkoutWrite): Promise<SavedStatus> {
  if (Date.parse(input.editedAt) > deps.now().getTime() + FUTURE_SLACK_MS) throw new FutureEditError();
  return await deps.sql.begin(async (tx) => {
    await holdLibrary(tx);
    await repo.lockPerson(tx, userId);
    const state = await repo.savedState(tx, id, userId, input.editedAt);
    if (state.kind === "theirs") throw new ForeignSavedError();
    if (state.kind === "removed") return "removed" as const;
    if (state.kind === "mine" && state.sameOrNewer) return "unchanged" as const;

    const slugs = [...new Set(input.exercises.map((e) => e.exercise))];
    const known = await knownExercises(tx, slugs);
    const unknown = slugs.filter((s) => !known.has(s));
    if (unknown.length > 0) throw new UnknownExercisesError(unknown.sort());
    const sets = input.exercises.flatMap((e, exercisePlace) => {
      const k = known.get(e.exercise);
      if (k === undefined) throw new Error(`writeSaved: ${e.exercise} is not known`);
      return e.sets.map((s, setPlace) => ({
        exercisePlace,
        setPlace,
        exerciseId: k.exerciseId,
        measuredIn: e.measuredIn,
        target: s.target,
        weightGrams: s.weightGrams,
        restSeconds: s.restSeconds,
      }));
    });

    if (state.kind === "mine") {
      if (!(await repo.updateSaved(tx, id, userId, input.name, input.editedAt))) throw new ForeignSavedError();
      await repo.replaceSets(tx, id, userId, sets);
      return "updated" as const;
    }
    if ((await repo.countOf(tx, userId)) >= PLANNED_WORKOUT_LIMITS.savedMost) throw new SavedFullError();
    // Under the person's own lock, an id taken in between is somebody else's.
    if (!(await repo.insertSaved(tx, id, userId, input.name, input.editedAt))) throw new ForeignSavedError();
    await repo.replaceSets(tx, id, userId, sets);
    return "created" as const;
  });
}

/** Deletes the person's saved workout; false for somebody else's. Sent twice, or for an id the server does
 *  not hold yet, it is still one delete: the id is kept, so a save of it on its way keeps nothing. */
export async function deleteSaved(deps: SavedDeps, userId: string, id: string): Promise<boolean> {
  return await deps.sql.begin(async (tx) => {
    await repo.lockPerson(tx, userId);
    return await repo.removeSaved(tx, id, userId);
  });
}

export async function listSaved(deps: SavedDeps, userId: string): Promise<SavedWorkoutList> {
  const rows = await repo.listOf(deps.sql, userId);
  return {
    savedWorkouts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      editedAt: r.edited_at.toISOString(),
      exercises: r.exercises ?? [],
      setsCount: r.sets_count,
    })),
    most: PLANNED_WORKOUT_LIMITS.savedMost,
  };
}

const measuredInSchema = z.enum(["reps", "time"]);

/** The person's own saved workout, whole; null for one that is not theirs or not there. */
export async function readSaved(deps: SavedDeps, userId: string, id: string): Promise<SavedWorkout | null> {
  const found = await repo.oneOf(deps.sql, userId, id);
  if (found === null) return null;
  const exercises: { exercise: string; measuredIn: "reps" | "time"; sets: { target: number; weightGrams: number | null; restSeconds: number | null }[] }[] = [];
  let place = -1;
  for (const s of found.sets) {
    if (s.exercise_place !== place) {
      place = s.exercise_place;
      exercises.push({ exercise: s.slug, measuredIn: measuredInSchema.parse(s.measured_in), sets: [] });
    }
    exercises[exercises.length - 1]?.sets.push({ target: s.target, weightGrams: s.weight_grams, restSeconds: s.rest_seconds });
  }
  // Parse, don't cast: what the columns hold is the shape the phone reads.
  return { id: found.row.id, name: found.row.name, editedAt: found.row.edited_at.toISOString(), exercises: z.array(plannedExerciseSchema).parse(exercises) };
}
