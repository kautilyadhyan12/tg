// The form judge (spec Part 2 §12.2 stage 6, §12.1): runs only inside a counted rep, on the mistakes the exercise names
// (its camera file, §12.3), and marks each one made, fine, or not seen from where the phone stands. It reads only the
// picture: a part the picture does not show, or shows too little of, decides nothing, and a 3D reading alone never gives
// advice (advice is strict, §12.1: the 3D points' own angles lie up to 26 degrees from the picture's in 5 frames of 100,
// 50c-iii). It never names an exercise or a mistake: each is data.
//
// One rep's frames are the matcher's own (from the rep's start to where it came back up), with how far down each was;
// the bottom is the matcher's (the frames within a tenth of the deepest), so a mistake and the count read the same rep.
import type { CheckedMistake, ExerciseCamera, MistakeRead, Movement } from "@app/shared";
import { MEASURE_LIST, type MeasureName, type MeasuredBody } from "../body/measures.js";

/** What the judge found of one mistake in one counted rep: made (the reading went past the mistake's line), fine, or
 *  unseen (the picture did not show it well enough from where the phone stands: "the camera cannot see this from
 *  here", for that rep). */
export type FormStatus = "made" | "fine" | "unseen";

export interface FormCheck {
  /** The mistake's id, its camera file's own. */
  readonly mistake: string;
  /** Its reading in this rep, in its measure's unit; null when unseen. */
  readonly reading: number | null;
  readonly status: FormStatus;
}

/** A frame of a rep as the judge reads it: its time, how far down it was (null when the drive was not seen), and each
 *  checked mistake's reading in it (null where the picture does not give it). */
export interface FormFrame {
  readonly t: number;
  readonly drop: number | null;
  readonly form: readonly (number | null)[];
}

/** The share of the frames a reading reads in which the picture must give it: below half, the camera saw it too little
 *  of the time to say anything (a part seen for a frame or two of the bottom is the model's guess). */
export const FORM_SEEN = 0.5;

/** Over the whole rep, a reading must be seen for at least this long, ms: from the front the bottom of a squat is never
 *  read for the knees' width (the thighs point at the phone), so a share of the rep's frames would turn on how long the
 *  person stayed down; 0.3 s is the matcher's own moment after a rep less its jump allowance, three frames at 8 a
 *  second, more than a part's flicker. */
export const FORM_SEEN_FOR = 300;

/** Side on: the body's own line from left to right, its hips, shows at most this share of itself on the picture.
 *  Measured at the bottom of the 23 squat sets (2026-11-22), where a mistake is read: side on they show 0.14 to 0.53 of
 *  it, from the front 0.61 to 1.00, half turned 0.19 to 0.93; the line lies between the two, turned about 55 degrees
 *  from the phone. */
export const SIDE_ON = 0.57;

/** The way up a mistake reads ends once the drive is back this share of the deepest. */
export const OUT_OF_BOTTOM = 0.5;

const KNOWN: ReadonlySet<string> = new Set(MEASURE_LIST.map((m) => m.name));

function isMeasure(name: string): name is MeasureName {
  return KNOWN.has(name);
}

function namesOf(read: MistakeRead): string[] {
  return read.kind === "value" ? read.measures : [...read.from, ...read.less];
}

/** The checked mistakes of an exercise, in its file's order. */
export function checkedOf(exercise: ExerciseCamera | null): CheckedMistake[] {
  return exercise === null ? [] : exercise.mistakes.flatMap((m) => (m.camera === "checked" ? [m] : []));
}

/** Refuses an exercise the engine cannot read rightly: on another movement, naming a measure the engine does not have,
 *  or leaving a mistake to a rule the movement does not have. */
export function checkExercise(exercise: ExerciseCamera, movement: Movement): void {
  if (exercise.movement !== movement.name) throw new Error(`${exercise.id} uses the movement ${exercise.movement}, not ${movement.name}.`);
  const wrong = exercise.mistakes.flatMap((m) => {
    if (m.camera === "checked") return namesOf(m.read).filter((n) => !KNOWN.has(n)).map((n) => `"${m.id}" reads ${n}, which the engine does not have`);
    if (m.camera === "counting" && !movement.rules.some((r) => r.name === m.rule)) return [`"${m.id}" is left to the rule "${m.rule}", which ${movement.name} does not have`];
    return [];
  });
  if (wrong.length > 0) throw new Error(`${exercise.id}: ${wrong.join("; ")}.`);
}

function mean(values: readonly (number | null)[]): number | null {
  const seen = values.filter((v): v is number => v !== null);
  return seen.length === 0 ? null : seen.reduce((a, b) => a + b, 0) / seen.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Whether the body stands side on to the phone this frame (`SIDE_ON`); false when its hips are not seen. */
export function sideOn(measured: MeasuredBody): boolean {
  const shown = measured.readings.get("hips apart")?.shown ?? null;
  return shown !== null && shown <= SIDE_ON;
}

/** One frame's reading of a mistake, on the picture only; null where the picture does not give it, or does not show
 *  it from where the phone stands (`view`). */
export function mistakeReading(mistake: CheckedMistake, measured: MeasuredBody): number | null {
  if (mistake.view === "side" && !sideOn(measured)) return null;
  const read: MistakeRead = mistake.read;
  const flat = (name: string): number | null => (isMeasure(name) ? (measured.readings.get(name)?.flat ?? null) : null);
  if (read.kind === "value") return mean(read.measures.map(flat));
  return mean(
    read.from.map((a, k) => {
      const x = flat(a);
      const b = read.less[k];
      const y = b === undefined ? null : flat(b);
      return x === null || y === null ? null : x - y;
    }),
  );
}

/** Whether readings at these times leave a break longer than `longest` anywhere from `from` to `to`. */
function breaks(times: readonly number[], from: number, to: number, longest: number): boolean {
  const marks = [from, ...times, to];
  return marks.slice(1).some((t, k) => t - (marks[k] ?? t) > longest);
}

/** How long a mistake was seen in these frames, ms: each frame that gives it counts until the next frame, never longer
 *  than a break may be. */
function seenFor(frames: readonly FormFrame[], k: number, longest: number): number {
  return frames.slice(0, -1).reduce((sum, f, i) => ((f.form[k] ?? null) === null ? sum : sum + Math.min(longest, (frames[i + 1]?.t ?? f.t) - f.t)), 0);
}

/** The readings of a mistake in these frames, where the picture gives it, with their times. */
function seenIn(frames: readonly FormFrame[], k: number): { t: number; v: number }[] {
  return frames.flatMap((f) => {
    const v = f.form[k] ?? null;
    return v === null ? [] : [{ t: f.t, v }];
  });
}

/**
 * One mistake in one counted rep. `frames` are the rep's, from its start to where it came back up; `k` the mistake's
 * place in each frame's `form`; `standing` its reading while the person stood ready before the rep (for a mistake taken
 * against standing); `band` the share of the deepest that is the bottom; `longest` the longest break in a reading that
 * decides nothing (the matcher's own). At the bottom and on the way up a reading must be seen in at least `FORM_SEEN` of
 * the frames it reads:
 *   - at the bottom: the middle of its readings in the bottom's frames;
 *   - on the way up, against the bottom: from the deepest frame until the drive is back half way up (`OUT_OF_BOTTOM`),
 *     where hips that rise before the chest show (higher up, a person straightens and settles), the most its reading
 *     went past its reading at the bottom (the least, for a mistake with a lower line), never broken off for longer than
 *     a break;
 *   - over the rep: seen for at least `FORM_SEEN_FOR`, its furthest wherever the picture gives it (from the front, the bottom of a squat points the thighs
 *     at the phone and the picture shows too little of them to read the knees' width there; on the way down and up it
 *     shows them).
 */
export function formOf(mistake: CheckedMistake, k: number, frames: readonly FormFrame[], standing: number | null, band: number, longest: number): FormCheck {
  const reading = readingIn(mistake, k, frames, standing, band, longest);
  if (reading === null) return { mistake: mistake.id, reading: null, status: "unseen" };
  const made = (mistake.atLeast !== undefined && reading < mistake.atLeast) || (mistake.atMost !== undefined && reading > mistake.atMost);
  return { mistake: mistake.id, reading, status: made ? "made" : "fine" };
}

function readingIn(mistake: CheckedMistake, k: number, frames: readonly FormFrame[], standing: number | null, band: number, longest: number): number | null {
  const furthest = (values: readonly number[]): number => (mistake.atLeast !== undefined ? Math.min(...values) : Math.max(...values));
  const against = mistake.against === "standing" ? standing : 0;
  if (mistake.at === "rep") {
    const seen = seenIn(frames, k);
    if (against === null || seen.length === 0 || seenFor(frames, k, longest) < FORM_SEEN_FOR) return null;
    return furthest(seen.map((s) => s.v - against));
  }
  const deepest = Math.max(...frames.map((f) => f.drop ?? Number.NEGATIVE_INFINITY));
  if (!Number.isFinite(deepest)) return null;
  const bottom = frames.filter((f) => f.drop !== null && f.drop >= deepest * (1 - band));
  const seenAtBottom = seenIn(bottom, k);
  const atBottom = median(seenAtBottom.map((s) => s.v));
  if (atBottom === null || seenAtBottom.length < FORM_SEEN * bottom.length) return null;
  if (mistake.at === "bottom") return against === null ? null : atBottom - against;
  const rest = frames.slice(frames.findIndex((f) => f.drop === deepest));
  const half = rest.findIndex((f) => f.drop !== null && f.drop < OUT_OF_BOTTOM * deepest);
  const up = half < 0 ? rest : rest.slice(0, half);
  const seen = seenIn(up, k);
  const first = up[0];
  const last = up[up.length - 1];
  if (first === undefined || last === undefined || seen.length === 0 || seen.length < FORM_SEEN * up.length) return null;
  if (breaks(seen.map((s) => s.t), first.t, last.t, longest)) return null;
  return furthest(seen.map((s) => s.v - atBottom));
}
