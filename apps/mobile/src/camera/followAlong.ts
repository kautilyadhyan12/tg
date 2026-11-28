import { COACH_LIMITS } from "@app/movement";
import { WORKOUT_SAVE_LIMITS } from "@app/shared";
import { READY_MS } from "../library/workoutRun";
import { SOUND_LATE_MS } from "../library/workoutSounds";
import { TIME_LEAST, TIME_MOST, stepTime } from "../library/workoutSetup";
import type { SoundName } from "../sound/soundNative";

// Follow along (ROADMAP Stage 5 53b-ii; RULINGS 2026-08-17): the other way to do a set, for a room where the camera may
// not be able to follow the person. The exercise's clip fills the phone, the camera is off, and a timer runs the set;
// nothing is ever counted from the clip. The set's own steps, pure: every press carries the phone's clock, and the set's
// clock moves on by the time that passed, never back, and not while paused (as the workout's own does, 64a-ii).

/** How long one rep takes at the timer's start: a set of 10 reps is followed for 30 s. */
export const FOLLOW_REP_MS = 3000;

export type FollowPhase = "ready" | "set" | "done";

export interface Follow {
  readonly measuredIn: "reps" | "time";
  /** The timer's length, in seconds. */
  readonly seconds: number;
  /** Getting ready (10 s, as a timed set in a workout has), following, or ended. */
  readonly phase: FollowPhase;
  /** The set's own clock, every pause left out, when the phase began. */
  readonly phaseAt: number;
  readonly activeMs: number;
  /** The phone's clock at the last press. */
  readonly seenAt: number;
  readonly paused: boolean;
  /** Once ended: how long the set was followed, and the reps the person says they did (a set measured in reps). */
  readonly doneMs: number;
  readonly reps: number;
  /** Half of the set has been followed (a set of 20 s or more): "Halfway." is said once a set, whatever the time is changed
   *  to after it (round one, L1). Reset set starts it again. */
  readonly halfway: boolean;
}

export type FollowPress =
  | { kind: "tick" }
  /** Start now: the get-ready skipped. */
  | { kind: "start" }
  | { kind: "time"; by: 1 | -1 }
  | { kind: "pause" }
  | { kind: "resume" }
  /** Reset set: back to getting ready, the time kept. */
  | { kind: "reset" }
  /** Set done: ended now, with the time followed so far. */
  | { kind: "done" }
  /** The person's own count, once ended. */
  | { kind: "reps"; by: 1 | -1 };

/** The timer for a set's target: 3 s a rep, or a hold's own time. */
export const followSecondsOf = (measuredIn: "reps" | "time", target: number): number =>
  measuredIn === "time" ? target : Math.min(TIME_MOST, Math.max(TIME_LEAST, Math.round((target * FOLLOW_REP_MS) / 1000)));

/** What the person's count starts at, by the same rule the timer was made from: the time followed at 3 s a rep. */
export const repsOfTime = (ms: number): number => Math.min(WORKOUT_SAVE_LIMITS.repsMost, Math.max(0, Math.round(ms / FOLLOW_REP_MS)));

export const startFollow = (measuredIn: "reps" | "time", target: number, now: number): Follow => ({
  measuredIn,
  seconds: followSecondsOf(measuredIn, target),
  phase: "ready",
  phaseAt: 0,
  activeMs: 0,
  seenAt: now,
  paused: false,
  doneMs: 0,
  reps: 0,
  halfway: false,
});

/** The set's target once the person goes back to the camera: a hold's is the time it was followed for, changed or not
 *  (round one, L2); a set of reps keeps its reps. */
export const targetAfterFollow = (f: Follow, target: number): number => (f.measuredIn === "time" ? f.seconds : target);

/** When the phase ends by itself, on the set's own clock; null once ended. */
export const followEndsAt = (f: Follow): number | null => (f.phase === "ready" ? f.phaseAt + READY_MS : f.phase === "set" ? f.phaseAt + f.seconds * 1000 : null);

/** The time left on the timer: of the get-ready, or of the set. */
export const followLeftMs = (f: Follow): number => {
  const end = followEndsAt(f);
  return end === null ? 0 : Math.max(0, end - f.activeMs);
};

/** How long the set has been followed: nothing while getting ready. */
export const followedMs = (f: Follow): number => (f.phase === "set" ? Math.max(0, Math.min(f.seconds * 1000, f.activeMs - f.phaseAt)) : f.phase === "done" ? f.doneMs : 0);

const ended = (f: Follow, doneMs: number): Follow => ({ ...f, phase: "done", doneMs, reps: f.measuredIn === "reps" ? repsOfTime(doneMs) : 0, paused: false });

/** The phases that end by themselves at this clock, in order: the get-ready, then the set; and whether half of it has been
 *  followed. */
function settle(f: Follow): Follow {
  let s = f;
  if (s.phase === "ready" && s.activeMs >= s.phaseAt + READY_MS) s = { ...s, phase: "set", phaseAt: s.phaseAt + READY_MS };
  if (s.phase === "set" && s.activeMs >= s.phaseAt + s.seconds * 1000) s = ended(s, s.seconds * 1000);
  if (!s.halfway && s.phase === "set" && s.seconds >= COACH_LIMITS.holdHalfwayFrom && followedMs(s) >= (s.seconds * 1000) / 2) s = { ...s, halfway: true };
  return s;
}

export function followPress(f: Follow, p: FollowPress, now: number): Follow {
  // The clock first: on by the time that passed while running, never back (a phone clock set back moves nothing).
  const running = !f.paused && f.phase !== "done";
  const moved = settle({ ...f, activeMs: running ? f.activeMs + Math.max(0, now - f.seenAt) : f.activeMs, seenAt: now });
  switch (p.kind) {
    case "tick":
      return moved;
    case "start":
      return moved.phase === "ready" ? { ...moved, phase: "set", phaseAt: moved.activeMs } : moved;
    case "time": {
      if (moved.phase === "done") return moved;
      const seconds = stepTime(moved.seconds, p.by);
      // Shortened to what has been followed or less: it ends with the time followed, never the shorter one (round one, H1).
      const followed = followedMs(moved);
      if (moved.phase === "set" && followed >= seconds * 1000) return ended({ ...moved, seconds }, followed);
      return settle({ ...moved, seconds });
    }
    case "pause":
      return moved.phase === "done" ? moved : { ...moved, paused: true };
    case "resume":
      return { ...moved, paused: false };
    case "reset":
      return moved.phase === "done" ? moved : { ...moved, phase: "ready", phaseAt: moved.activeMs, doneMs: 0, reps: 0, halfway: false };
    case "done":
      return moved.phase === "done" ? moved : ended(moved, followedMs(moved));
    case "reps": {
      if (moved.phase !== "done" || moved.measuredIn !== "reps") return moved;
      const reps = moved.reps + p.by;
      return reps < 0 || reps > WORKOUT_SAVE_LIMITS.repsMost ? moved : { ...moved, reps };
    }
  }
}

/** What the coach says while following: only the lines a timer can say truly (`lines.json`'s `when`). */
export type FollowSay = "get ready" | "halfway" | "set complete";

export interface FollowHeard {
  readonly beeps: readonly SoundName[];
  readonly say: FollowSay | null;
}

const NOTHING: FollowHeard = { beeps: [], say: null };
const COUNT_FROM_S = 3;

/** What a press sounds, from the set before it and after it: a beep at each of the last 3 seconds of the get-ready and of
 *  the set, a rising "go" when the set starts, "Halfway." once a set, as half of a set of 20 s or more is followed (the
 *  coach's own line for a hold, `COACH_LIMITS.holdHalfwayFrom`), "Get ready." on Reset set, "Set complete." when it ends. None while paused, for Pause
 *  and Resume, or for a tick that comes late (the app was asleep: a burst of old beeps would say nothing true about now).
 *  "Get ready." as Follow along begins is the screen's own (`startFollow` is no press). */
export function followSounds(before: Follow, after: Follow, p: FollowPress, now: number): FollowHeard {
  if (before.paused || after.paused || p.kind === "pause" || p.kind === "resume" || p.kind === "reps") return NOTHING;
  if (p.kind === "tick" && now - before.seenAt > SOUND_LATE_MS) return NOTHING;
  if (before.phase !== "done" && after.phase === "done") return { beeps: [], say: "set complete" };
  if (p.kind === "reset") return { beeps: [], say: "get ready" };
  if (before.phase === "ready" && after.phase === "set") return { beeps: ["go"], say: null };
  if (!before.halfway && after.halfway) return { beeps: [], say: "halfway" };
  if (before.phase !== after.phase || before.phaseAt !== after.phaseAt) return NOTHING;
  if (p.kind !== "tick") return NOTHING;
  const leftBefore = followLeftMs(before);
  const leftAfter = followLeftMs(after);
  for (let s = COUNT_FROM_S; s >= 1; s--) {
    if (leftBefore > s * 1000 && leftAfter <= s * 1000) return { beeps: ["count"], say: null };
  }
  return NOTHING;
}
