import { WORKOUT_SAVE_LIMITS, type RunExercise, type SavedSet, type WorkoutRun, type WorkoutSave } from "@app/shared";
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
  | { kind: "end" };

/** What a press leaves: the workout going on (or done, to save), or nothing to keep: it ended with no set done. */
export type Outcome = { kind: "on"; run: WorkoutRun } | { kind: "gone" };

export interface Start {
  workoutId: string;
  name: string;
  /** The phone's clock when Start workout was pressed. */
  now: number;
  timeZone: string;
  exercises: readonly RunExercise[];
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
const timeLeftMs = (r: WorkoutRun): number => Math.max(0, L.lengthMostMs - r.done.reduce((t, s) => t + s.durationMs + (s.restSeconds ?? 0) * 1000, 0));

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

/** When the phase ends by itself, on the active clock: a rest, a get-ready, a set measured in time. */
export function endsAt(r: WorkoutRun): number | null {
  if (r.phase === "rest" || r.phase === "ready") return r.phaseEndsAt;
  if (r.phase === "set" && exerciseOf(r).measuredIn === "time") return r.phaseAt + setOf(r).target * 1000;
  return null;
}

/** The set at the workout's place starts now; one measured in time gets ready first unless a rest came before it. */
function begin(r: WorkoutRun, afterRest: boolean): WorkoutRun {
  if (exerciseOf(r).measuredIn === "time" && !afterRest) return { ...r, phase: "ready", phaseAt: r.activeMs, phaseEndsAt: r.activeMs + READY_MS, count: 0 };
  return { ...r, phase: "set", phaseAt: r.activeMs, phaseEndsAt: null, count: 0 };
}

/** The set being done is done, with `done` reps or seconds; then its rest, the next set, or the end. */
function complete(r: WorkoutRun, done: number): WorkoutRun {
  const { exercise, target, weightGrams, restSeconds } = setOf(r);
  const durationMs = Math.min(r.activeMs - r.phaseAt, timeLeftMs(r));
  const most = exercise.measuredIn === "reps" ? L.repsMost : Math.min(L.secondsMost, Math.floor(durationMs / 1000));
  const set: SavedSet = {
    exercise: exercise.exercise,
    position: r.done.length,
    measuredIn: exercise.measuredIn,
    target,
    done: Math.max(0, Math.min(most, done)),
    weightGrams,
    restSeconds: null,
    durationMs,
    counted: exercise.measuredIn === "time" ? "timer" : "hand",
  };
  const ran: WorkoutRun = { ...r, done: [...r.done, set], count: 0 };
  const next = nextOf(r);
  if (next === null || ran.done.length >= L.setsMost) return { ...ran, phase: "done", phaseAt: r.activeMs, phaseEndsAt: null };
  const moved = { ...ran, ex: next.ex, set: next.set };
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
function advance(r: WorkoutRun, now: number, back: boolean): WorkoutRun {
  const dt = Math.max(0, now - r.seenAt);
  let run: WorkoutRun = { ...r, seenAt: now };
  if (run.phase === "done") return run;
  if (run.paused || (back && dt > AWAY_MOST_MS)) return { ...run, paused: true, totalMs: capped(run.totalMs + dt) };
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
  const run = advance(r, now, p.kind === "back");
  if (run.phase === "done") return { kind: "on", run };
  const on = (next: WorkoutRun): Outcome => ({ kind: "on", run: next });
  const { exercise, target, weightGrams } = setOf(run);
  const timed = exercise.measuredIn === "time";
  if (p.kind === "tick" || p.kind === "back") return on(run);
  if (p.kind === "pause") return on({ ...run, paused: true });
  if (p.kind === "resume") return on({ ...run, paused: false });
  if (p.kind === "end") {
    const ended = run.phase === "rest" ? endRest(run) : run;
    return ended.done.length === 0 ? { kind: "gone" } : on({ ...ended, phase: "done", phaseAt: ended.activeMs, phaseEndsAt: null, paused: false });
  }
  // Paused, nothing moves but Resume.
  if (run.paused) return p.kind === "main" ? on({ ...run, paused: false }) : on(run);
  const withSet = (change: { target?: number; weightGrams?: number | null }): WorkoutRun => ({
    ...run,
    exercises: run.exercises.map((e, i) => (i !== run.ex ? e : { ...e, sets: e.sets.map((s, j) => (j === run.set ? { ...s, ...change } : s)) })),
  });
  switch (p.kind) {
    case "main":
      if (run.phase === "rest") return on(endRest(run));
      if (run.phase === "ready") return on(begin(run, true));
      return on(setDone(run));
    case "count": {
      if (run.phase !== "set" || timed) return on(run);
      const count = Math.max(0, Math.min(L.repsMost, run.count + p.by));
      return on(count >= target ? complete({ ...run, count }, count) : { ...run, count });
    }
    case "target": {
      if (run.phase !== "set") return on(run);
      const next = timed ? stepTime(target, p.by) : Math.max(1, Math.min(L.repsMost, target + p.by));
      const changed = withSet({ target: next });
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
      if (run.phase !== "set") return on(run);
      return on({ ...run, count: 0, phaseAt: run.activeMs });
    case "skipExercise": {
      if (run.phase === "rest") return on(run);
      if (run.ex + 1 >= run.exercises.length) return run.done.length === 0 ? { kind: "gone" } : on({ ...run, phase: "done", phaseAt: run.activeMs, phaseEndsAt: null });
      return on(begin({ ...run, ex: run.ex + 1, set: 0 }, false));
    }
  }
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
 *  less than its sets and rests; null with no set done. */
export function toSave(r: WorkoutRun, platform: WorkoutSave["platform"], appVersion: string): WorkoutSave | null {
  if (r.done.length === 0) return null;
  const used = r.done.reduce((t, s) => t + s.durationMs + (s.restSeconds ?? 0) * 1000, 0);
  const lengthMs = Math.max(used, Math.min(L.lengthMostMs, r.totalMs));
  const started = Date.parse(r.startedAt);
  const name = r.name.trim();
  return {
    workoutId: r.workoutId,
    name: name === "" ? null : name.slice(0, L.nameMost),
    startedAt: r.startedAt,
    endedAt: new Date(started + lengthMs).toISOString(),
    timeZone: r.timeZone,
    startedFrom: "none",
    effort: null,
    heart: [],
    platform,
    appVersion: appVersion.slice(0, 40),
    sets: r.done.map((s, position) => ({ ...s, position })),
  };
}
