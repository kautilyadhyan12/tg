// A hold (spec Part 2 §12.3, §11.8 step 6; ROADMAP 52c-ii): a clock that runs only while the position is held. It reads a
// hold's file (`holdMovementSchema`): a list of conditions, each a body measure inside its bound, every one of which must
// hold in a picture for that picture to be held. Pure, like the matcher: the same frames in give the same time out.
//
// The worst thing a hold could do to a person is time a hold nobody held, or keep the clock running after they let go. So:
//   - the position must hold for a whole second (`settle`) before it is a hold; a leg raise passing through it, or a
//     body moving through it on the way to another, is never timed; once it has, that second counts too (the person held
//     it all along), so a real hold is timed as long as it lasted;
//   - the clock stops at the last picture held: the picture a condition breaks in, and every picture after it, is never
//     held time;
//   - a picture in which a condition cannot be read (the body hidden, a part off the picture) never starts or ends a hold by
//     itself: unread pictures between two held ones are bridged, and counted, only while the gap between the two held
//     pictures is no longer than a break (`gap`, 0.2 s: the phone's live mode drops pictures so); a longer gap ends the hold,
//     and what was not seen then is never counted. So a hold's time can be a little more than the time the camera read the
//     person (a set's `watchedMs`), never more than the set's own length;
//   - a clock that goes back is a new set: nothing of the old one is carried, its time held included.
import type { HoldMovement } from "@app/shared";
import type { MeasuredBody } from "../body/measures.js";
import { readPosition, unknownMeasures, within } from "./matcher.js";

/** The hold's own waits, the same for every hold. */
export interface HoldLimits {
  /** The position must hold this long, ms, before it is a hold; the time counts from its first picture held. */
  readonly settle: number;
  /** The longest gap between two held pictures, ms, that a hold bridges (pictures not read in between, never a picture
   *  that broke the position); a longer one ends it. */
  readonly gap: number;
}

/**
 * Where each number comes from. `settle`: a second. A hold is held for seconds (Kd's research file on the tuck L-sit
 * starts at 5 to 15 s; his L-sit videos hold 3 and 8 s, his support hold 6.6 s); a leg raise on the bars passes through an
 * L-sit's shape in well under a second at the top. `gap`: the matcher's own plain break (`MATCH_LIMITS.gap`, 0.2 s): the
 * phone's live mode leaves up to 4 camera pictures between two it reads, 133 ms, and half again.
 */
export const HOLD_LIMITS: HoldLimits = { settle: 1000, gap: 200 };

/** One hold, from its first picture held to its last, ms of the frames' own clock. */
export interface HoldResult {
  readonly start: number;
  readonly end: number;
}

export interface HoldFrame {
  readonly t: number;
  /** The clock is running at this picture: it is held, inside a hold that has passed `settle`. */
  readonly holding: boolean;
  /** The time held so far in the set, ms. */
  readonly heldMs: number;
  /** A condition could not be read this picture: the clock pauses, and the screen says `reason`. */
  readonly unseen: boolean;
  /** What the screen says while the camera cannot read the position (the hold's `unseen`); null otherwise. */
  readonly reason: string | null;
  /** A hold that ended at this picture (it was let go, or lost from view longer than a break); null otherwise. */
  readonly hold: HoldResult | null;
}

/** One picture as the clock reads it: held, broken (false), or not read (null). */
export interface HeldPicture {
  readonly t: number;
  readonly holds: boolean | null;
}

/** Refuses a hold the engine cannot read rightly: a measure it does not have would read nothing and decide nothing. */
export function checkHold(hold: HoldMovement): void {
  const unknown = unknownMeasures(hold.position);
  if (unknown.length > 0) throw new Error(`${hold.name} names measures the engine does not have: ${unknown.join(", ")}.`);
}

/** Whether the position holds in this picture: true, false where a condition is read and outside its bound, null where a
 *  condition cannot be read (and none is broken). */
export function heldNow(hold: HoldMovement, measured: MeasuredBody): boolean | null {
  let unread = false;
  for (const c of hold.position) {
    const v = readPosition(c.read, measured);
    if (v === null) unread = true;
    else if (!within(v, c)) return false;
  }
  return unread ? null : true;
}

/** The holds in a run of pictures, and the time held, by the rules above (`HoldMatcher` gives the same, picture by picture). */
export function heldOf(pictures: readonly HeldPicture[], limits: HoldLimits = HOLD_LIMITS): { heldMs: number; holds: HoldResult[] } {
  const clock = new HoldClock(limits);
  let holds: HoldResult[] = [];
  let lastT: number | null = null;
  for (const p of pictures) {
    // A clock that went back is a new set, as it is to the clock.
    if (lastT !== null && p.t < lastT) holds = [];
    lastT = p.t;
    const ended = clock.next(p.t, p.holds);
    if (ended !== null) holds.push(ended);
  }
  const last = clock.finish();
  if (last !== null) holds.push(last);
  return { heldMs: holds.reduce((n, h) => n + h.end - h.start, 0), holds };
}

/** The clock alone: told each picture's time and whether it was held, it keeps the holds. */
class HoldClock {
  /** The run of held pictures going on: its first and last held picture; null when none. */
  private run: { start: number; last: number } | null = null;
  private done = 0;
  /** The newest picture's time, held or not: a picture earlier than it is a clock that went back. */
  private lastT: number | null = null;

  constructor(private readonly limits: HoldLimits) {}

  /** A clock that went back starts afresh, whether a hold was going on or had ended: nothing of the old set is carried, its
   *  time held included (round one: a 5 s hold let go before the time went back was still counted in the next set). Returns a
   *  hold that ended here. */
  next(t: number, holds: boolean | null): HoldResult | null {
    if (this.lastT !== null && t < this.lastT) {
      this.run = null;
      this.done = 0;
    }
    this.lastT = t;
    const run = this.run;
    // A gap longer than a break since the last held picture ends the run (what was not seen is not counted).
    let ended: HoldResult | null = null;
    if (run !== null && (holds === false || t - run.last > this.limits.gap)) {
      ended = this.close(run);
      this.run = null;
    }
    if (holds === true) {
      const now = this.run;
      this.run = now === null ? { start: t, last: t } : { start: now.start, last: t };
    }
    return ended;
  }

  /** The set has ended: a run going on is closed. */
  finish(): HoldResult | null {
    const run = this.run;
    this.run = null;
    return run === null ? null : this.close(run);
  }

  /** Whether the run going on is a hold yet (it has held for `settle`). */
  holding(): boolean {
    const run = this.run;
    return run !== null && run.last - run.start >= this.limits.settle;
  }

  /** The time held so far: every hold closed, and the run going on once it is a hold. */
  heldMs(): number {
    const run = this.run;
    return this.done + (run !== null && this.holding() ? run.last - run.start : 0);
  }

  /** A run that held for `settle` or longer is a hold; a shorter one is nothing. */
  private close(run: { start: number; last: number }): HoldResult | null {
    if (run.last - run.start < this.limits.settle) return null;
    this.done += run.last - run.start;
    return { start: run.start, end: run.last };
  }
}

/** A hold, picture by picture, from the body measures (50c). */
export class HoldMatcher {
  private readonly clock: HoldClock;
  /** The frame given for the newest picture: given again for a picture that repeats its time. */
  private lastFrame: HoldFrame | null = null;

  constructor(
    private readonly hold: HoldMovement,
    limits: HoldLimits = HOLD_LIMITS,
  ) {
    checkHold(hold);
    this.clock = new HoldClock(limits);
  }

  next(measured: MeasuredBody): HoldFrame {
    const t = measured.t;
    // A picture with the same time as the one before decides nothing: the frame before is given again, never "unseen" (a
    // camera that repeats a picture would flash "Keep your whole body in view." on a hold going fine; round one).
    const before = this.lastFrame;
    if (before !== null && t === before.t) return { ...before, hold: null };
    const held = heldNow(this.hold, measured);
    const hold = this.clock.next(t, held);
    const frame: HoldFrame = { t, holding: held === true && this.clock.holding(), heldMs: this.clock.heldMs(), unseen: held === null, reason: held === null ? this.hold.unseen : null, hold };
    this.lastFrame = frame;
    return frame;
  }

  /** The set has ended: a hold going on ends at its last picture held. */
  finish(): HoldFrame | null {
    const t = this.lastFrame?.t ?? null;
    if (t === null) return null;
    const hold = this.clock.finish();
    return { t, holding: false, heldMs: this.clock.heldMs(), unseen: false, reason: null, hold };
  }
}
