// What form-check does (spec Part 2 §12.5; ROADMAP 52b-ii-a): sets the line of each mistake an exercise has the camera
// check, from the same people's reps the movement's numbers are set from, and proves that no line is ever passed on a
// good-form video.
//
// The rule that sets a line, in words Kd can read. Every rep of the people the numbers are set from is read, as filmed
// and as each replay that changes only how the camera reads a body (the very reps movementCheck.ts `fit` reads). Advice
// is strict (§12.1), so a line is never nearer the reps than either of these, whichever lies further out:
//   - the form standard's own line, where a proper source gives one (`standard`), moved out by the camera's own room on
//     that reading (how much the same rep's reading changes between as filmed and each such replay, in 99 reps of 100);
//   - the furthest rep any of those people did, moved out by the same room: every one of their videos is a good-form
//     video, so a reading any of them reached is not a mistake.
// Rounded outward, to a whole degree or a hundredth of a trunk. A person's videos are left out together: the lines are
// set from all the people but one and tried on that one, in turn.
import type { CheckedMistake, ExerciseCamera, Movement } from "@app/shared";
import { MEASURE_LIST, checkedOf, type RepResult } from "../src/index.js";
import { asReplayed, countedTimes, fit, proofVideos, repsOf, roomOfReading, runMovement, seedOf, withNumbers, type ProofVideo } from "./movementCheck.js";
import { REPLAYS, type Replay } from "./replays.js";

const UNIT: ReadonlyMap<string, string> = new Map(MEASURE_LIST.map((m) => [m.name, m.unit]));

/** A whole degree, or a hundredth of anything else. */
function stepOf(m: CheckedMistake): number {
  const first = m.read.kind === "value" ? m.read.measures[0] : m.read.from[0];
  return UNIT.get(first ?? "") === "degrees" ? 1 : 0.01;
}

/** Rounded outward: away from the reps. */
function outward(value: number, size: number, up: boolean): number {
  const n = up ? Math.ceil(value / size - 1e-9) : Math.floor(value / size + 1e-9);
  return Math.round(n * size * 1e6) / 1e6;
}

/** One mistake's reading in a rep, null where unseen or not judged. */
export function readingOf(r: RepResult, id: string): number | null {
  return r.form.find((f) => f.mistake === id)?.reading ?? null;
}

export interface FormFitted {
  readonly mistake: string;
  readonly bound: number;
  /** The furthest rep's reading, how many reps were read, and the middle of them. */
  readonly furthest: number;
  readonly middle: number;
  readonly reps: number;
  /** The camera's room on this reading, and how many reps, as filmed and replayed, it was measured on. */
  readonly room: { readonly size: number; readonly pairs: number };
  /** The standard's line moved by the room, where the mistake has a standard. */
  readonly fromStandard: number | null;
}

function middleOf(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Sets every checked mistake's line from the reps of the videos given (those that may set numbers). */
export function fitForm(movement: Movement, exercise: ExerciseCamera, videos: readonly ProofVideo[]): FormFitted[] {
  const reps = repsOf(movement, videos.flatMap((v) => [v, ...asReplayed(v)]), exercise);
  return checkedOf(exercise).map((m) => {
    const up = m.atMost !== undefined;
    const values = reps.flatMap((r) => {
      const v = readingOf(r, m.id);
      return v === null ? [] : [v];
    });
    if (values.length === 0) throw new Error(`No rep of ${exercise.id} read "${m.id}": nothing to set it from.`);
    const furthest = up ? Math.max(...values) : Math.min(...values);
    const room = roomOfReading(movement, videos, (r) => readingOf(r, m.id), up, exercise);
    const signed = up ? room.size : -room.size;
    const fromStandard = m.standard === undefined ? null : m.standard.at + signed;
    const fromReps = furthest + signed;
    const raw = fromStandard === null ? fromReps : up ? Math.max(fromStandard, fromReps) : Math.min(fromStandard, fromReps);
    return { mistake: m.id, bound: outward(raw, stepOf(m), up), furthest, middle: middleOf(values), reps: values.length, room, fromStandard };
  });
}

export function withFormNumbers(exercise: ExerciseCamera, fitted: readonly FormFitted[]): ExerciseCamera {
  return {
    ...exercise,
    mistakes: exercise.mistakes.map((m) => {
      const f = fitted.find((x) => x.mistake === m.id);
      if (f === undefined || m.camera !== "checked") return m;
      return m.atLeast !== undefined ? { ...m, atLeast: f.bound } : { ...m, atMost: f.bound };
    }),
  };
}

/** A mistake the judge marked made, in a counted rep. */
export interface Made {
  readonly at: number;
  readonly mistake: string;
  readonly reading: number | null;
}

export interface FormRow {
  readonly label: string;
  readonly person: string;
  /** null: as filmed. */
  readonly replay: Replay | null;
  /** With the numbers set from everybody but this video's person (the movement's and the mistakes'). */
  readonly leftOut: boolean;
  readonly counted: number;
  readonly made: readonly Made[];
}

const madeOf = (reps: readonly RepResult[]): Made[] =>
  reps.flatMap((r) => (r.verdict !== "counted" ? [] : r.form.filter((f) => f.status === "made").map((f) => ({ at: r.start, mistake: f.mistake, reading: f.reading }))));

/** Every good-form video of the movement (a count by eye, no open case), as filmed and under each replay given, with
 *  the exercise's own lines and, for a video that sets numbers, with its person left out of every number: the mistakes
 *  the judge marked made. On a good-form video there must be none. */
export function formRows(movement: Movement, exercise: ExerciseCamera, replays: readonly Replay[] = REPLAYS.filter((r) => r.hold), videos: readonly ProofVideo[] = proofVideos()): FormRow[] {
  const judged = videos.filter((v) => v.entry.movement === movement.name && v.entry.reps !== null && v.entry.open === undefined);
  const setting = videos.filter((v) => v.entry.movement === movement.name && v.video.sets);
  const folds = new Map<string, { movement: Movement; exercise: ExerciseCamera }>();
  const foldOf = (person: string): { movement: Movement; exercise: ExerciseCamera } => {
    const known = folds.get(person);
    if (known !== undefined) return known;
    const others = setting.filter((v) => v.entry.person !== person);
    const m = withNumbers(movement, fit(movement, others));
    const made = { movement: m, exercise: withFormNumbers(exercise, fitForm(movement, exercise, others)) };
    folds.set(person, made);
    return made;
  };
  return [null, ...replays].flatMap((replay) =>
    judged.flatMap((v) => {
      const frames = replay === null ? v.video.frames : replay.edit(v.video.frames, seedOf(v.video.label, replay.name), countedTimes(movement, v.video));
      const video = { ...v.video, frames };
      const run = runMovement(movement, video, exercise);
      const own: FormRow = { label: v.video.label, person: v.entry.person, replay, leftOut: false, counted: run.count, made: madeOf(run.reps) };
      if (!v.video.sets) return [own];
      const fold = foldOf(v.entry.person);
      const out = runMovement(fold.movement, video, fold.exercise);
      return [own, { label: v.video.label, person: v.entry.person, replay, leftOut: true, counted: out.count, made: madeOf(out.reps) }];
    }),
  );
}
