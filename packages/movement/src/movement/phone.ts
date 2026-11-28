// The phone moved in a set (ROADMAP 53c; spec Part 2 §12.5, "As built, the phone moved in a set"). Every number the engine
// reads is a place on the picture, and a phone knocked, picked up or held by hand moves the whole picture: the person's
// still feet seem to travel and their place is somewhere else, so a squat is another movement and the lock (52d) refuses
// them for the rest of the set (53b-i, on the laptop: a squat's picture swaying as a hand does counted 3 of 3 at 0.2 cm of
// sway on an 11 cm person, 0 of 3 from 0.5 cm). This stage reads how far the phone itself turned, from its own gyroscope
// (`MovementFrame.spin`), and says, picture by picture:
//   - **moving**: the phone points elsewhere than a moment ago, keeps turning (a knock, a hand waving it), or trembles as
//     a hand always does, however steadily it holds it: nothing in the picture is read, no count and no word but "Keep the
//     phone still.";
//   - **again**: the phone stands still again after moving, or, after the camera gave no picture for a while (Pause, the
//     app away), its tilt is not what it was: from this picture the stages that measure the body start afresh, the count
//     going on, and the person is still the one the set has counted, at their place and size (CameraSet; round one, C1 and
//     H1: the lock thrown away with them let a stranger take the set after every Pause).
// A reference video carries no `spin` (its camera stands still), and a phone with no gyroscope says none: neither is ever
// moving. Pure: the frames' own times and the phone's own readings. Nothing in this is any exercise's own.
import type { Down, Spin } from "@app/shared";

export interface PhoneLimits {
  /** The turning is read over this last stretch of the set, ms. */
  readonly window: number;
  /** Turned further than this over `window`, radians, the phone points elsewhere: it has moved. */
  readonly turned: number;
  /** Turning this far in all over `window`, radians, back and forth or not: it keeps moving. */
  readonly shake: number;
  /** Trembling: in every `quarter` ms of the last `tremble` ms, its turning went back and forth at least `tremor` radians in
   *  all (each answer's turning against the quarter's own mean: a gyroscope's steady drift, and any steady turn, are not
   *  back and forth). A hand never stops trembling. */
  readonly tremor: number;
  readonly quarter: number;
  readonly tremble: number;
  /** Still again once, for this long (ms), it has turned no more than `steady` in all over each `window` and has not been
   *  trembling. */
  readonly settle: number;
  readonly steady: number;
  /** No picture for this long, ms (Pause, the app away, a camera that stalled): its turning meanwhile is not known, so it
   *  counts as moved only if its tilt ("down") is further than `tilted` radians from what it was before. */
  readonly stopped: number;
  readonly tilted: number;
}

const DEGREE = Math.PI / 180;

/**
 * Where each number comes from (§12.5, "As built, the phone moved in a set"): Kd's phone's own gyroscope, read by the camera
 * module with its camera screen open (2026-11-28, test/phone-motion). Lying still on a desk it turned 0.06 to 0.09 degrees
 * in each half second (the gyroscope's own drift, about 0.14 a second) and 0.06 to 0.14 in all; once, unexplained, 0.6
 * degrees and 1.4 in all; with the desk tapped hard beside it, 0.18 in all. Held in a hand, 1 to 13 degrees in all in most
 * half seconds, its steadiest moments 0.4 to 0.7. A turn of 1.5 degrees is where a squat's picture starts to be another
 * movement: 53b-i measured a sway of 0.2 cm on an 11 cm person kept every squat and 0.5 cm lost every one, 1.8 and 4.5 in 100
 * of the body's height, 0.7 and 1.7 degrees of a body 1.7 m tall 2.5 m from the phone. So moving past 1.5 degrees turned or 3
 * degrees in all in half a second (the still phone's blip 0.4 and 0.5 of them). **Trembling** (Kd's walk the same day: held
 * in his hand steadily, under those two, it counted a whole set and was never told; held by hand it must be): the smallest
 * quarter second's back and forth over the last 1.5 s was at most 0.042 degrees lying still and 0.051 with the desk tapped,
 * at least 0.152 in the hand (0.44 in the middle), and under 0.05 the moment it was laid down. 0.09 lies about 1.7 times
 * from each. (First built on the turning with the gyroscope's drift taken out, the drift estimated over the last seconds:
 * the hand's sway in that estimate kept a phone just laid down trembling up to 2 s, and the member's next rep was lost.)
 * Back and forth has no drift in it, so a gyroscope that drifts faster reads the same. Still again after a
 * whole second under 0.5 degrees in all and not trembling; played on those readings, the still phone is never moving, the
 * phone is moving 0.03 s after it was picked up and in every picture it was held, and stands again once, 1 s after it lay
 * still. `stopped`: a second with no picture, five or more lost at the camera's slowest 8 a second (`SLOWEST_RATE`), is the
 * camera off, not a slow picture. `tilted`: his phone's gravity reading, lying still 4.5 minutes, tilted at most 1.03 degrees
 * between any two moments (0.36 lying still after it was laid down); 2 degrees is twice that. Picked up and laid flat on the
 * desk again it read 0.74 degrees from before: a phone put back at the same tilt is not seen, and the person, still the
 * set's, is found again at their place.
 */
export const PHONE_LIMITS: PhoneLimits = {
  window: 500,
  turned: 1.5 * DEGREE,
  shake: 3 * DEGREE,
  tremor: 0.09 * DEGREE,
  quarter: 250,
  tremble: 1500,
  settle: 1000,
  steady: 0.5 * DEGREE,
  stopped: 1000,
  tilted: 2 * DEGREE,
};

export interface PhoneFrame {
  /** The phone is moving: nothing in this picture is read. */
  readonly moving: boolean;
  /** From this picture the stages that measure the body start afresh, the count going on: the phone stands again after
   *  moving, or after a while with no picture it is tilted otherwise than before. */
  readonly again: boolean;
  /** How far the phone turned over the last `window`: net (where it points against where it pointed) and in all, radians;
   *  null for a reference video. */
  readonly turned: number | null;
  readonly path: number | null;
  /** Whether it trembles as a hand does (`PhoneLimits.tremor`). */
  readonly trembling: boolean;
}

const STILL: PhoneFrame = { moving: false, again: false, turned: null, path: null, trembling: false };

/** One answer's turning: when, and how far. */
interface Turn {
  readonly t: number;
  readonly spin: Spin;
}

const size = (s: readonly [number, number, number]): number => Math.hypot(s[0], s[1], s[2]);

/** The angle between two unit "down"s, radians. */
const angleOf = (a: Down, b: Down): number => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

export class PhoneMotion {
  private readonly limits: PhoneLimits;
  private lastT: number | null = null;
  /** Every answer's turning over the longest stretch read (`tremble`, or `window` if longer). */
  private turns: Turn[] = [];
  /** Since when the turning has been read without a gap: trembling needs the whole of `tremble` read. */
  private since: number | null = null;
  private moving = false;
  private stillSince: number | null = null;
  /** The newest "down" read. */
  private down: Down | null = null;

  constructor(limits: PhoneLimits = PHONE_LIMITS) {
    this.limits = limits;
  }

  /** One picture: its time, how far the phone turned since the picture before (absent for a reference video; null when
   *  the phone could not say, which adds nothing), and which way is down. */
  next(t: number, spin: Spin | null | undefined, down: Down | null = null): PhoneFrame {
    if (spin === undefined) return STILL;
    const last = this.lastT;
    // A clock that went back is a new set.
    if (last !== null && t < last) this.reset();
    // A picture with the same time: its turning is added to the answer before, and decides nothing new (round one, L2).
    if (last !== null && t === last) {
      const before = this.turns[this.turns.length - 1];
      if (spin !== null && before !== undefined && before.t === t) this.turns[this.turns.length - 1] = { t, spin: [before.spin[0] + spin[0], before.spin[1] + spin[1], before.spin[2] + spin[2]] };
      else if (spin !== null) this.turns.push({ t, spin });
      return this.frame(t, false, this.trembling(t));
    }
    this.lastT = t;
    const downBefore = this.down;
    if (down !== null) this.down = down;
    // The camera gave no picture for a while: its turning meanwhile is not known; moved if it was moving when the pictures
    // stopped (the re-check's Low: forgotten, a phone put back at its tilt carried on with the old picture's body), or if
    // its tilt changed.
    if (last !== null && t - last > this.limits.stopped) {
      const tilted = down !== null && downBefore !== null && angleOf(down, downBefore) > this.limits.tilted;
      const wasMoving = this.moving;
      this.reset();
      this.lastT = t;
      this.down = down ?? downBefore;
      return this.frame(t, tilted || wasMoving, false);
    }
    if (spin !== null) this.turns.push({ t, spin });
    this.since ??= t;
    const keep = Math.max(this.limits.tremble, this.limits.window);
    this.turns = this.turns.filter((x) => x.t > t - keep);
    const { turned, path } = this.sums(t);
    const trembling = this.trembling(t);
    if (!this.moving) {
      if (turned > this.limits.turned || path > this.limits.shake || trembling) {
        this.moving = true;
        this.stillSince = null;
      }
      return this.frame(t, false, trembling);
    }
    if (path > this.limits.steady || trembling) {
      this.stillSince = null;
      return this.frame(t, false, trembling);
    }
    this.stillSince ??= t;
    if (t - this.stillSince < this.limits.settle) return this.frame(t, false, trembling);
    this.moving = false;
    this.stillSince = null;
    this.turns = [];
    this.since = t;
    return this.frame(t, true, false);
  }

  /** How far it turned over the last `window`: net, and in all. */
  private sums(t: number): { turned: number; path: number } {
    let x = 0;
    let y = 0;
    let z = 0;
    let path = 0;
    for (const { t: at, spin } of this.turns) {
      if (at <= t - this.limits.window) continue;
      x += spin[0];
      y += spin[1];
      z += spin[2];
      path += size(spin);
    }
    return { turned: Math.hypot(x, y, z), path };
  }

  /** Whether in every `quarter` of the last `tremble` its turning went back and forth at least `tremor`: each answer's
   *  turning against the mean of the answers in its quarter, summed. False until `tremble` has been read. */
  private trembling(t: number): boolean {
    const { tremor, quarter, tremble } = this.limits;
    if (this.since === null || t - this.since < tremble) return false;
    const recent = this.turns.filter((x) => x.t > t - tremble);
    let quarters = 0;
    // Each quarter that ends at an answer and lies wholly in the last `tremble`.
    for (const end of recent) {
      if (end.t - quarter < t - tremble) continue;
      const inQuarter = recent.filter((x) => x.t > end.t - quarter && x.t <= end.t);
      const n = inQuarter.length;
      const mx = inQuarter.reduce((m, x) => m + x.spin[0], 0) / n;
      const my = inQuarter.reduce((m, x) => m + x.spin[1], 0) / n;
      const mz = inQuarter.reduce((m, x) => m + x.spin[2], 0) / n;
      const back = inQuarter.reduce((m, x) => m + size([x.spin[0] - mx, x.spin[1] - my, x.spin[2] - mz]), 0);
      if (back < tremor) return false;
      quarters++;
    }
    return quarters > 0;
  }

  private frame(t: number, again: boolean, trembling: boolean): PhoneFrame {
    const { turned, path } = this.sums(t);
    return { moving: this.moving, again, turned, path, trembling };
  }

  private reset(): void {
    this.down = null;
    this.lastT = null;
    this.turns = [];
    this.since = null;
    this.moving = false;
    this.stillSince = null;
  }
}
