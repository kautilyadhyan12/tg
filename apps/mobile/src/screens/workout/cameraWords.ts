import { setFormScore, type SavedSet, type WorkoutRun } from "@app/shared";
import { setOf } from "../../library/workoutRun";
import type { Units } from "../../library/records";
import { setLine } from "./words";

// The camera's words in a workout (ROADMAP Stage 5 64b-ii; Kd's own words for the question, 2026-11-28). Pure.

/** Under the question, every time: what stays on the phone (Kd's words). */
export const ASK_PRIVACY = "Your phone processes the camera feed. KWAZO never saves the video or sends it to servers or any third party.";
export const START_WITH_CAMERA = "Start with camera";
export const COUNT_MANUALLY = "Count manually";
export const OPEN_SETTINGS = "Open settings";
/** The rest after a camera set, where the next set is the camera's too. */
export const RESUMES_WORDS = "Camera tracking resumes when the rest ends.";
/** The button that opens the rest's box. */
export const REST_BOX_WORDS = "Rest, reps, pause";
export const REST_BOX_HOLD_WORDS = "Rest, pause";

/** The question as an exercise the camera counts starts: what the camera does for this exercise, and never more. A form
 *  check only where the exercise has form rules (its camera file); a hold is timed, never counted. */
export function askWords(name: string, measuredIn: "reps" | "time", judged: boolean): { eyebrow: string; title: string; line: string } {
  const what = name.toLowerCase();
  const eyebrow = name.toUpperCase();
  if (measuredIn === "time") {
    return judged
      ? { eyebrow, title: "Live form check", line: `Use your camera to time your hold and get feedback on your ${what} form in real time.` }
      : { eyebrow, title: "Live hold timer", line: "Use your camera to time your hold in real time." };
  }
  return judged
    ? { eyebrow, title: "Live form check", line: `Use your camera to count reps and get feedback on your ${what} form in real time.` }
    : { eyebrow, title: "Live rep count", line: "Use your camera to count your reps in real time." };
}

/** The number of the set just done, within its exercise. */
export function lastSetNumber(r: WorkoutRun): number {
  const last = r.done[r.done.length - 1];
  if (last === undefined) return 1;
  let n = 0;
  for (let i = r.done.length - 1; i >= 0 && r.done[i]?.exercise === last.exercise; i--) n += 1;
  return n;
}

/** The set just done, where the camera counted it: the rest after it is the camera's (Kd's drawing, board 4). */
export function lastCameraSet(r: WorkoutRun): SavedSet | null {
  const last = r.done[r.done.length - 1];
  return r.phase === "rest" && last?.counted === "camera" ? last : null;
}

/** What the rest after a camera set says of it: "SET 2 COMPLETE", the reps (or seconds held) kept, and its form score where
 *  the camera judged its reps; and what comes next, with its exercise's name where it is another. */
export function restWords(r: WorkoutRun, last: SavedSet, units: Units): { eyebrow: string; done: string; doneLabel: string; form: number | null; next: string; resumes: boolean } {
  const { exercise } = setOf(r);
  const line = setLine(r, units);
  return {
    eyebrow: `Set ${String(lastSetNumber(r))} complete`,
    done: String(last.done),
    doneLabel: last.measuredIn === "time" ? "Seconds" : "Reps",
    form: last.measuredIn === "reps" ? setFormScore(last.camera?.summary?.repScores ?? []) : null,
    next: exercise.exercise === last.exercise ? line : `${exercise.name} · ${line}`,
    resumes: r.way === "camera",
  };
}
