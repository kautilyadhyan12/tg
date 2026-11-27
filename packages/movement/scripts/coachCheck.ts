// The coach on the proof's own reps (ROADMAP 53b-i; spec Part 2 §12.5: "each mistake video plays its own line, and no
// correction plays on a good-form video"): what it would say over a set's judged reps, every rep in its order.
import type { ExerciseCamera, Movement } from "@app/shared";
import { Coach, coachWords, checkedOf, parseExercise, type RepResult, type SayKind } from "../src/index.js";
import { readVoice } from "./voiceLines.js";

const WORDS = coachWords(readVoice());

export interface Said {
  /** When, in the run's own clock, ms. */
  readonly t: number;
  readonly words: string;
  readonly kind: SayKind;
}

/** What the coach says over a set's reps, with the count as the camera counted it and the target given (none: no count
 *  lines). */
export function saidOf(reps: readonly RepResult[], exercise: ExerciseCamera | null, target: number | null = null): Said[] {
  const coach = new Coach(exercise, WORDS);
  let count = 0;
  return reps.flatMap((r) => {
    if (r.verdict === "counted") count += 1;
    const say = coach.rep(r, count, target);
    return say === null ? [] : [{ t: r.end, words: say.words, kind: say.kind }];
  });
}

/** The exercise with every mistake the camera checks spoken, a silent one in its refusal's words or its own name: the
 *  proof's worst case, so that no proper rep would be told anything even were each correction said. */
export function speaking(exercise: ExerciseCamera, movement: Movement): ExerciseCamera {
  return parseExercise(
    {
      ...exercise,
      mistakes: exercise.mistakes.map((m) => (m.camera === "checked" && "silent" in m.coach ? { ...m, coach: { words: m.refused?.words ?? `${m.name}.` } } : m)),
    },
    movement,
  );
}

/** Each checked mistake's correction as `speaking` gives it, by its id. */
export function correctionsOf(exercise: ExerciseCamera): ReadonlyMap<string, string> {
  return new Map(checkedOf(exercise).flatMap((m): [string, string][] => ("words" in m.coach ? [[m.id, m.coach.words]] : [])));
}
