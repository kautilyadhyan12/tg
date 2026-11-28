import { MOVEMENT_ENGINE_VERSION } from "@app/movement";
import {
  HEART_BPM_LEAST,
  HEART_BPM_MOST,
  repScoresIn,
  setsAndRestsMs,
  WORKOUT_SAVE_LIMITS,
  type CameraSetFacts,
  type CameraSummary,
  type RunCamera,
  type RunExercise,
  type SavedSet,
  type WorkoutRun,
  type WorkoutSave,
} from "@app/shared";
import type { Units } from "./records";
import { stepTime, stepWeight } from "./workoutSetup";

// Doing a workout (ROADMAP Stage 5 64a-ii; spec Part 2 §13.6, §11.8's steps; Kd's drawing of 2026-11-21): the
// workout's steps as one pure piece. The same presses in give the same workout out; the screen only draws it, and the
// phone writes it to a file at every step. Every press carries the phone's clock (`now`), and the workout's own clocks
// are moved on by the time that passed, never back: a clock set back during a workout adds nothing.
//
// A set by hand counts reps and ends by itself at its target, or on Set done; a set measured in time is a timer that
// ends by itself at its target. After a set comes its rest, then the next set by itself. A set measured in time with
// no rest before it (the first set, after Skip exercise, after "no rest") has 10 s to get ready first.
//
// With the camera (64b-ii; §11.8's steps 3 to 6): an exercise the camera counts on this phone asks, as it starts, how it is
// counted, every time; its set waits for the answer. Chosen, each of its sets is counted by the camera, and ends at its
// target with what the camera judged of it (`cameraDone`, which the screen sends with the engine's summary): the set keeps
// the camera's facts, the only set that does. Count this set myself, or the camera stopping, leaves the camera for the rest
// of that set (`leave`); Follow along puts the camera off and the set is the person's own count or the timer's.

/** Before a timed set with no rest before it. */
export const READY_MS = 10_000;
/** Away from the app for longer than this (closed, or in the background), the workout comes back paused from the
 *  moment it was last seen, so a forgotten workout never counts hours nobody trained. */
export const AWAY_MOST_MS = 10 * 60_000;
export const REST_STEP_MS = 15_000;
const L = WORKOUT_SAVE_LIMITS;
/** The longest a kept workout's clocks run, paused included, as its file allows: a save takes at most 12 hours of it. */
export const CLOCK_MOST_MS = L.lengthMostMs * 4;
const capped = (ms: number): number => Math.min(CLOCK_MOST_MS, ms);

export type Press =
  /** Time passes: the screen's clock. */
  | { kind: "tick" }
  /** The app is open again: brought back, or started with a workout in its file. */
  | { kind: "back" }
  | { kind: "count"; by: 1 | -1 }
  | { kind: "target"; by: 1 | -1 }
  | { kind: "weight"; by: 1 | -1; units: Units }
  /** The main button: Set done, Skip rest, Start now, or Resume. */
  | { kind: "main" }
  | { kind: "rest"; by: 1 | -1 }
  /** The set just done, put right during its rest (did 12, not 10). */
  | { kind: "last"; by: 1 | -1 }
  | { kind: "reset" }
  | { kind: "skipExercise" }
  | { kind: "pause" }
  | { kind: "resume" }
  /** End and save. */
  | { kind: "end" }
  /** How the exercise is counted, as it starts (Start with camera, Count manually); "camera" also turns the camera on for a
   *  set being counted by hand. */
  | { kind: "way"; way: "camera" | "hand" }
  /** The camera's own count and a hold's time held, each time either changes. */
  | { kind: "camera"; reps: number; heldMs: number }
  /** The camera's set ends: at its target, or on Set done. */
  | { kind: "cameraDone"; end: CameraEnd }
  /** The rest of the set by hand: Count this set myself, or the camera stopped. */
  | { kind: "leave"; why: "chosen" | "camera_stopped"; end: CameraEnd }
  /** Follow along: the camera off, the set started again, followed with the clip. */
  | { kind: "follow" }
  /** Follow along ended: the person's own count, or a hold's time followed, in seconds. */
  | { kind: "followed"; done: number }
  /** Follow along's own Count this set myself: the set started again, by hand. */
  | { kind: "handSet" };

/** What the camera made of a set as it ended or was left (`LiveSet.end`): its count in all, a hold's time held, and its
 *  judgement in the save's own shape (`cameraSummaryOf`), null for an exercise with no form rules. */
export interface CameraEnd {
  readonly reps: number;
  readonly heldMs: number;
  readonly summary: CameraSummary | null;
}

/** What a press leaves: the workout going on (or done, to save), or nothing to keep: it ended with no set done. */
export type Outcome = { kind: "on"; run: WorkoutRun } | { kind: "gone" };

export interface Start {
  workoutId: string;
  name: string;
  /** The phone's clock when Start workout was pressed. */
  now: number;
  timeZone: string;
  exercises: readonly RunExercise[];
  /** "saved": My Workout holds one of the person's saved workouts (64a-iv). */
  startedFrom?: "saved" | "none";
}

/** A new workout at its first set; null with no exercise to do. */
export function startRun(s: Start): WorkoutRun | null {
  const exercises = firstSets(s.exercises);
  if (exercises.length === 0) return null;
  const run: WorkoutRun = {
    v: 1,
    workoutId: s.workoutId,
    name: s.name,
    startedAt: new Date(s.now).toISOString(),
    timeZone: s.timeZone,
    exercises,
    ex: 0,
    set: 0,
    phase: "set",
    phaseAt: 0,
    phaseEndsAt: null,
    count: 0,
    paused: false,
    totalMs: 0,
    activeMs: 0,
    seenAt: s.now,
    done: [],
    ...(s.startedFrom === "saved" ? { startedFrom: "saved" as const } : {}),
  };
  return begin(run, false);
}

/** As many sets as one workout may save (200), the first ones in order; an exercise left with none is left out (round
 *  one, L3). My Workout says so where it holds more. */
export function firstSets(exercises: readonly RunExercise[]): RunExercise[] {
  let left: number = L.setsMost;
  const out: RunExercise[] = [];
  for (const e of exercises) {
    if (left <= 0) break;
    const sets = e.sets.slice(0, left);
    left -= sets.length;
    if (sets.length > 0) out.push(sets.length === e.sets.length ? e : { ...e, sets });
  }
  return out;
}

/** What a save allows of a workout's sets and rests together, left after the sets done so far: a set or a rest left
 *  open for longer is kept as no longer than that (round one, H2), so every workout stays one the server takes. */
const timeLeftMs = (r: WorkoutRun): number => Math.max(0, L.lengthMostMs - setsAndRestsMs(r.done));

const exerciseOf = (r: WorkoutRun): RunExercise => {
  const e = r.exercises[r.ex];
  if (e === undefined) throw new Error("no exercise here");
  return e;
};

/** The set the workout is at: being done, being got ready for, or coming after the rest. */
export function setOf(r: WorkoutRun): { exercise: RunExercise; target: number; weightGrams: number | null; restSeconds: number | null } {
  const exercise = exerciseOf(r);
  const s = exercise.sets[r.set];
  if (s === undefined) throw new Error("no set here");
  return { exercise, target: s.target, weightGrams: s.weightGrams, restSeconds: s.restSeconds };
}

/** The place after this one: the next set of this exercise, else the next exercise's first. */
export function nextOf(r: WorkoutRun): { ex: number; set: number } | null {
  const e = exerciseOf(r);
  if (r.set + 1 < e.sets.length) return { ex: r.ex, set: r.set + 1 };
  if (r.ex + 1 < r.exercises.length) return { ex: r.ex + 1, set: 0 };
  return null;
}

/** The workout asks how the exercise is counted: the camera counts it on this phone and nothing is chosen yet. Its set, or
 *  its get-ready, waits for the answer. */
export const asking = (r: WorkoutRun): boolean => (r.phase === "set" || r.phase === "ready") && r.way === undefined && exerciseOf(r).camera === true;

/** The camera is counting the set being done. */
export const tracking = (r: WorkoutRun): boolean => r.phase === "set" && r.way === "camera" && r.cam !== undefined && r.cam.left === null;

/** The set is being followed with the exercise's clip, the camera off (Follow along). */
export const following = (r: WorkoutRun): boolean => r.phase === "set" && r.follow === true;

/** The camera has counted the set to its target (reps counted, the person's own changes with them; or a hold's time held):
 *  the screen ends it with what the camera judged (`cameraDone`). The workout never ends a camera's set without it. */
export function cameraReached(r: WorkoutRun): boolean {
  if (!tracking(r) || r.cam === undefined) return false;
  const { exercise, target } = setOf(r);
  return exercise.measuredIn === "time" ? r.cam.heldMs >= target * 1000 : r.count >= target;
}

/** When the phase ends by itself, on the active clock: a rest, a get-ready, a set measured in time. Never while the workout
 *  asks how the exercise is counted, nor for a hold the camera times or the clip's timer runs. */
export function endsAt(r: WorkoutRun): number | null {
  if (asking(r)) return null;
  if (r.phase === "rest" || r.phase === "ready") return r.phaseEndsAt;
  if (r.phase === "set" && exerciseOf(r).measuredIn === "time" && !tracking(r) && !following(r)) return r.phaseAt + setOf(r).target * 1000;
  return null;
}

/** A camera set beginning now, on the workout's whole clock. */
const freshCamera = (r: WorkoutRun): RunCamera => ({ done: 0, heldMs: 0, seenReps: 0, seenHeldMs: 0, left: null, summary: null, at: r.totalMs });

/** The set at the workout's place starts now; one measured in time gets ready first unless a rest came before it. With the
 *  camera chosen, the camera counts it, and a hold needs no get-ready: the camera waits for the person to take position. */
function begin(r: WorkoutRun, afterRest: boolean): WorkoutRun {
  // Follow along, once chosen, is how the exercise's next sets start too, the camera still off: a busy room stays busy.
  if (r.way === "camera" && r.follow === true) return { ...r, phase: "set", phaseAt: r.activeMs, phaseEndsAt: null, count: 0, cam: undefined };
  if (r.way === "camera") return { ...r, phase: "set", phaseAt: r.activeMs, phaseEndsAt: null, count: 0, cam: freshCamera(r), follow: undefined };
  const plain: WorkoutRun = { ...r, cam: undefined, follow: undefined };
  if (exerciseOf(r).measuredIn === "time" && !afterRest) return { ...plain, phase: "ready", phaseAt: r.activeMs, phaseEndsAt: r.activeMs + READY_MS, count: 0 };
  return { ...plain, phase: "set", phaseAt: r.activeMs, phaseEndsAt: null, count: 0 };
}

/** What the camera's count says now, taken into the set: what it counted since it last said, unless paused, when nothing it
 *  sees is the set's. A count that went back (never, from one set's engine) takes nothing. */
function taken(r: WorkoutRun, cam: RunCamera, reps: number, heldMs: number): { count: number; cam: RunCamera } {
  const sure = (n: number, most: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(most, Math.floor(n))) : 0);
  const seenReps = Math.max(cam.seenReps, sure(reps, L.repsMost));
  const seenHeldMs = Math.max(cam.seenHeldMs, sure(heldMs, L.secondsMost * 1000));
  if (r.paused) return { count: r.count, cam: { ...cam, seenReps, seenHeldMs } };
  const more = seenReps - cam.seenReps;
  return {
    count: Math.min(L.repsMost, r.count + more),
    cam: { ...cam, seenReps, seenHeldMs, done: Math.min(L.repsMost, cam.done + more), heldMs: Math.min(L.secondsMost * 1000, cam.heldMs + seenHeldMs - cam.seenHeldMs) },
  };
}

/** A camera set's judgement, kept only where the save takes it whole: a score for each rep the camera counted at most, none
 *  for a hold, and no more rep scores in the workout than a save takes. Otherwise none: never a form score cut short, nor a
 *  workout the server would refuse. */
function keptSummary(r: WorkoutRun, summary: CameraSummary | null, scorable: number): CameraSummary | null {
  if (summary === null) return null;
  const n = summary.repScores.length;
  return n > scorable || repScoresIn(r.done) + n > L.repScoresMost ? null : summary;
}

/** The camera's facts of a set it counted: its own count (or whole seconds held, no longer than the set lasted), why it was
 *  left, the engine, and its judgement. */
function cameraFacts(r: WorkoutRun, cam: RunCamera, measuredIn: "reps" | "time", durationMs: number): CameraSetFacts {
  const done = measuredIn === "reps" ? cam.done : Math.min(L.secondsMost, Math.floor(cam.heldMs / 1000), Math.floor(durationMs / 1000));
  return { done, left: cam.left, engineVersion: MOVEMENT_ENGINE_VERSION, summary: keptSummary(r, cam.summary, measuredIn === "reps" ? done : 0) };
}

/** The set being done is done, with `done` reps or seconds; then its rest, the next set, or the end. THE WORST THING HERE: a
 *  form score kept for a set no camera watched. A set keeps the camera's facts only where the camera was chosen and counted
 *  it (`cam`): never one counted by hand, by a timer, or followed with the clip. */
function complete(r: WorkoutRun, done: number): WorkoutRun {
  const { exercise, target, weightGrams, restSeconds } = setOf(r);
  const durationMs = Math.min(r.activeMs - r.phaseAt, timeLeftMs(r));
  const most = exercise.measuredIn === "reps" ? L.repsMost : Math.min(L.secondsMost, Math.floor(durationMs / 1000));
  const cam = r.way === "camera" && r.follow !== true ? r.cam : undefined;
  const set: SavedSet = {
    exercise: exercise.exercise,
    position: r.done.length,
    measuredIn: exercise.measuredIn,
    target,
    done: Math.max(0, Math.min(most, done)),
    weightGrams,
    restSeconds: null,
    durationMs,
    counted: cam !== undefined ? "camera" : exercise.measuredIn === "time" ? "timer" : "hand",
    ...(cam === undefined ? {} : { camera: cameraFacts(r, cam, exercise.measuredIn, durationMs) }),
  };
  const ran: WorkoutRun = { ...r, done: [...r.done, set], count: 0, cam: undefined, follow: undefined };
  const next = nextOf(r);
  if (next === null || ran.done.length >= L.setsMost) return { ...ran, phase: "done", phaseAt: r.activeMs, phaseEndsAt: null };
  // The next exercise is asked about afresh.
  // A set followed with the clip: the same exercise's next set is followed too (until the camera is turned on again).
  const moved: WorkoutRun = { ...ran, ex: next.ex, set: next.set, ...(next.ex === r.ex ? (r.follow === true ? { follow: true as const } : {}) : { way: undefined }) };
  const rest = restSeconds ?? 0;
  if (rest > 0) return { ...moved, phase: "rest", phaseAt: r.activeMs, phaseEndsAt: r.activeMs + rest * 1000 };
  return begin(moved, false);
}

/** The rest is over: the rest taken is kept with the set before it, and the next set starts. */
function endRest(r: WorkoutRun): WorkoutRun {
  const taken = Math.min(L.restSecondsMost, Math.floor((r.activeMs - r.phaseAt) / 1000), Math.floor(timeLeftMs(r) / 1000));
  const last = r.done[r.done.length - 1];
  const done = last === undefined ? r.done : [...r.done.slice(0, -1), { ...last, restSeconds: taken > 0 ? taken : null }];
  return begin({ ...r, done }, true);
}

/** The set being done ends now, with what it shows: reps counted (the target where none were), or the time held. */
function setDone(r: WorkoutRun): WorkoutRun {
  const { exercise, target } = setOf(r);
  if (exercise.measuredIn === "time") return complete(r, Math.min(target, Math.floor((r.activeMs - r.phaseAt) / 1000)));
  return complete(r, r.count > 0 ? r.count : target);
}

/** The phase that ended by itself at its time. */
function expire(r: WorkoutRun): WorkoutRun {
  if (r.phase === "rest") return endRest(r);
  if (r.phase === "ready") return begin(r, true);
  return complete(r, setOf(r).target);
}

/** The workout moved on to the phone's clock `now`: every phase that ended meanwhile ends at its own time, in order.
 *  A workout done stops its clocks. */
function advance(r: WorkoutRun, now: number, pressed: boolean): WorkoutRun {
  const dt = Math.max(0, now - r.seenAt);
  let run: WorkoutRun = { ...r, seenAt: now };
  if (run.phase === "done") return run;
  // A press (the screen's clock included) after longer than AWAY_MOST_MS: the clock moves every 250 ms while the app is open,
  // so a gap that long means the app was away, even where its clock reaches the workout before "back" does (round one, L1).
  // Only for a press: a page drawing the time from an older copy has been open all along (the re-check's H1).
  if (run.paused || (pressed && dt > AWAY_MOST_MS)) return { ...run, paused: true, totalMs: capped(run.totalMs + dt) };
  const startTotal = run.totalMs;
  const startActive = run.activeMs;
  const to = capped(run.activeMs + dt);
  for (;;) {
    const end = endsAt(run);
    if (end === null || end > to) break;
    run = expire({ ...run, activeMs: Math.max(run.activeMs, end) });
    if (run.phase === "done") return { ...run, totalMs: capped(startTotal + (run.activeMs - startActive)) };
  }
  return { ...run, activeMs: to, totalMs: Math.max(to, capped(startTotal + dt)) };
}

/** One press, at the phone's clock `now`. */
export function press(r: WorkoutRun, p: Press, now: number): Outcome {
  const run = advance(r, now, true);
  if (run.phase === "done") return { kind: "on", run };
  const on = (next: WorkoutRun): Outcome => ({ kind: "on", run: next });
  const { exercise, target, weightGrams } = setOf(run);
  const timed = exercise.measuredIn === "time";
  if (p.kind === "tick" || p.kind === "back") return on(run);
  if (p.kind === "pause") return on({ ...run, paused: true });
  if (p.kind === "resume") return on({ ...run, paused: false });
  if (p.kind === "end") {
    const ended = run.phase === "rest" ? endRest(run) : run;
    return ended.done.length === 0 ? { kind: "gone" } : on({ ...ended, phase: "done", phaseAt: ended.activeMs, phaseEndsAt: null, paused: false, cam: undefined, follow: undefined });
  }
  const camera = cameraPress(run, p);
  if (camera !== null) return on(camera);
  // While the workout asks how the exercise is counted, its set waits: only Skip exercise moves it.
  if (asking(run) && p.kind !== "skipExercise") return on(run);
  // Paused, nothing moves but Resume; a set the camera counts is changed in its box while paused (the box stays open).
  if (run.paused && !(tracking(run) && (p.kind === "count" || p.kind === "target" || p.kind === "weight" || p.kind === "reset"))) {
    return p.kind === "main" && !tracking(run) ? on({ ...run, paused: false }) : on(run);
  }
  const withSet = (change: { target?: number; weightGrams?: number | null }): WorkoutRun => ({
    ...run,
    exercises: run.exercises.map((e, i) => (i !== run.ex ? e : { ...e, sets: e.sets.map((s, j) => (j === run.set ? { ...s, ...change } : s)) })),
  });
  switch (p.kind) {
    case "main":
      if (run.phase === "rest") return on(endRest(run));
      if (run.phase === "ready") return on(begin(run, true));
      // The camera's set ends with what the camera judged (`cameraDone`); a set followed, with the person's count.
      if (tracking(run) || following(run)) return on(run);
      return on(setDone(run));
    case "count": {
      if (run.phase !== "set" || timed || following(run)) return on(run);
      const count = Math.max(0, Math.min(L.repsMost, run.count + p.by));
      // The camera's set reaching its target is ended by the screen, with what the camera judged.
      if (tracking(run)) return on({ ...run, count });
      return on(count >= target ? complete({ ...run, count }, count) : { ...run, count });
    }
    case "target": {
      if (run.phase !== "set" || following(run)) return on(run);
      const next = timed ? stepTime(target, p.by) : Math.max(1, Math.min(L.repsMost, target + p.by));
      const changed = withSet({ target: next });
      if (tracking(run)) return on(changed);
      // Reps counted already reach the new target: the set is done with them.
      if (!timed && changed.count > 0 && changed.count >= next) return on(complete(changed, changed.count));
      // A time cut below what has been held ends the set at once, at the time held.
      if (timed && changed.activeMs - changed.phaseAt >= next * 1000) return on(complete(changed, next));
      return on(changed);
    }
    case "weight":
      if (run.phase !== "set" && run.phase !== "ready") return on(run);
      return on(withSet({ weightGrams: stepWeight(weightGrams, p.by, p.units, exercise.barbell) }));
    case "rest": {
      if (run.phase !== "rest" || run.phaseEndsAt === null) return on(run);
      const ends = Math.min(run.phaseAt + L.restSecondsMost * 1000, run.phaseEndsAt + p.by * REST_STEP_MS);
      return on(ends <= run.activeMs ? endRest(run) : { ...run, phaseEndsAt: ends });
    }
    case "last": {
      const last = run.done[run.done.length - 1];
      if (run.phase !== "rest" || last === undefined || last.measuredIn !== "reps") return on(run);
      const done = Math.max(0, Math.min(L.repsMost, last.done + p.by));
      return on({ ...run, done: [...run.done.slice(0, -1), { ...last, done }] });
    }
    case "reset":
      // Follow along's own Reset set is its timer's.
      if (run.phase !== "set" || following(run)) return on(run);
      // The set starts again: its count, its time, and the camera's own count, judged afresh; a set left to the person
      // stays theirs.
      return on({ ...run, count: 0, phaseAt: run.activeMs, ...(run.cam === undefined ? {} : { cam: { ...freshCamera(run), left: run.cam.left } }) });
    case "skipExercise": {
      if (run.phase === "rest") return on(run);
      if (run.ex + 1 >= run.exercises.length) {
        return run.done.length === 0 ? { kind: "gone" } : on({ ...run, phase: "done", phaseAt: run.activeMs, phaseEndsAt: null, cam: undefined, follow: undefined });
      }
      return on(begin({ ...run, ex: run.ex + 1, set: 0, way: undefined }, false));
    }
    case "way":
    case "camera":
    case "cameraDone":
    case "leave":
    case "follow":
    case "followed":
    case "handSet":
      return on(run);
  }
}

/** A press of the camera's (64b-ii), at the workout moved on to now; null for every other press. Each works while paused:
 *  the camera's count is kept as said but taken by the set only while it runs. */
function cameraPress(run: WorkoutRun, p: Press): WorkoutRun | null {
  const timed = exerciseOf(run).measuredIn === "time";
  switch (p.kind) {
    case "way": {
      if (asking(run)) {
        // Chosen: the camera's set starts now. Counted by hand: the set, or a hold's get-ready, starts now.
        if (p.way === "camera") return begin({ ...run, way: "camera" }, true);
        return begin({ ...run, way: "hand" }, run.phase === "set");
      }
      if (p.way !== "camera" || exerciseOf(run).camera !== true) return run;
      // Start with camera on a set counted by hand, or back from Follow along: the camera counts from now. A set of reps keeps
      // the reps already counted (the person's own); a hold, and a set followed, start again.
      if (run.phase === "ready" && run.way === "hand") return begin({ ...run, way: "camera" }, true);
      if (run.phase !== "set" || tracking(run) || (run.cam !== undefined && run.cam.left !== null)) return run;
      const again = following(run) || timed;
      return { ...run, way: "camera", follow: undefined, cam: freshCamera(run), ...(again ? { count: 0, phaseAt: run.activeMs } : {}) };
    }
    case "camera": {
      if (!tracking(run) || run.cam === undefined) return run;
      const t = taken(run, run.cam, p.reps, p.heldMs);
      return { ...run, count: t.count, cam: t.cam };
    }
    case "cameraDone": {
      if (!tracking(run) || run.cam === undefined) return run;
      const t = taken(run, run.cam, p.end.reps, p.end.heldMs);
      const ending: WorkoutRun = { ...run, count: t.count, cam: { ...t.cam, summary: p.end.summary }, paused: false };
      return complete(ending, timed ? Math.floor(t.cam.heldMs / 1000) : t.count);
    }
    case "leave": {
      if (!tracking(run) || run.cam === undefined) return run;
      const t = taken(run, run.cam, p.end.reps, p.end.heldMs);
      const cam: RunCamera = { ...t.cam, left: p.why, summary: p.end.summary };
      // A hold goes on as the workout's own timer, from the time the camera saw it held.
      return { ...run, count: t.count, cam, ...(timed ? { phaseAt: Math.max(0, run.activeMs - t.cam.heldMs) } : {}) };
    }
    case "follow":
      if (!tracking(run)) return run;
      return { ...run, follow: true, cam: undefined, count: 0, phaseAt: run.activeMs };
    case "followed": {
      if (!following(run)) return run;
      const done = Number.isFinite(p.done) ? Math.max(0, Math.floor(p.done)) : 0;
      return complete({ ...run, paused: false }, done);
    }
    case "handSet":
      if (!following(run)) return run;
      return { ...run, follow: undefined, count: 0, phaseAt: run.activeMs };
    default:
      return null;
  }
}

/** One reading from the person's own monitor: the phone's clock when it came, beats a minute. */
export interface HeartIn {
  at: number;
  bpm: number;
}
/** At most one reading kept a second, as a run keeps them. */
export const HEART_EVERY_MS = 900;

/** The monitor's readings since the workout was last moved on (64a-vi), kept with it before the press at `now` is
 *  pressed. THE WORST THING HERE: a heart rate kept as this workout's that is not the person's during it. So nothing is
 *  kept while it is paused, after more than AWAY_MOST_MS since it was last moved on, whatever the press (that time is not
 *  trained, and the workout comes back paused: round one, L1), or once it is done; a reading from before the workout was last moved on (before Start, during a pause, a
 *  clock set back) is not kept; each is placed on the workout's whole clock by when it came, one a second at most, in
 *  order, and none past what a save allows. Which monitor sent it is the monitor's own rule (`monitor.ts`). */
export function withHeart(r: WorkoutRun, readings: readonly HeartIn[], now: number): WorkoutRun {
  if (readings.length === 0 || r.paused || r.phase === "done") return r;
  if (now - r.seenAt > AWAY_MOST_MS) return r;
  const kept = r.heart ?? [];
  const heart: [number, number][] = [...kept];
  let last = heart[heart.length - 1]?.[0] ?? -HEART_EVERY_MS;
  for (const { at, bpm } of readings) {
    if (!Number.isFinite(at) || at < r.seenAt || !Number.isInteger(bpm) || bpm < HEART_BPM_LEAST || bpm > HEART_BPM_MOST) continue;
    const ms = Math.round(r.totalMs + (Math.min(at, now) - r.seenAt));
    if (ms - last < HEART_EVERY_MS || ms > L.lengthMostMs || heart.length >= L.heartMost) continue;
    heart.push([ms, bpm]);
    last = ms;
  }
  return heart.length === kept.length ? r : { ...r, heart };
}

/** What the screen shows of the clocks at the phone's clock `now`, without pressing anything. */
export function shownAt(r: WorkoutRun, now: number): WorkoutRun {
  return advance(r, now, false);
}

/** Milliseconds left of the phase that ends by itself, and how long it is in all; null for a set by hand. */
export function leftOf(r: WorkoutRun): { leftMs: number; ofMs: number } | null {
  const end = endsAt(r);
  if (end === null) return null;
  return { leftMs: Math.max(0, end - r.activeMs), ofMs: Math.max(1, end - r.phaseAt) };
}

/** How many sets the workout has in all. */
export const setsInAll = (r: WorkoutRun): number => r.exercises.reduce((n, e) => n + e.sets.length, 0);

/** The finished workout as the server takes it, under its own id. Its length is no more than a save allows and never
 *  less than its sets and rests; its time trained (64a-ii-b) is the time its screen showed, every pause left out, held
 *  the same way and within the length. Null with no set done. */
export function toSave(r: WorkoutRun, platform: WorkoutSave["platform"], appVersion: string): WorkoutSave | null {
  if (r.done.length === 0) return null;
  const used = setsAndRestsMs(r.done);
  const lengthMs = Math.max(used, Math.min(L.lengthMostMs, r.totalMs));
  const trainedMs = Math.min(lengthMs, Math.max(used, Math.min(L.lengthMostMs, r.activeMs)));
  const started = Date.parse(r.startedAt);
  const name = r.name.trim();
  return {
    workoutId: r.workoutId,
    name: name === "" ? null : name.slice(0, L.nameMost),
    startedAt: r.startedAt,
    endedAt: new Date(started + lengthMs).toISOString(),
    timeZone: r.timeZone,
    startedFrom: r.startedFrom ?? "none",
    effort: null,
    // Only readings within the length the save sends: one past it would make the server refuse the whole workout.
    heart: (r.heart ?? []).filter(([at]) => at <= lengthMs),
    platform,
    appVersion: appVersion.slice(0, 40),
    sets: r.done.map((s, position) => ({ ...s, position })),
    trainedMs,
  };
}
