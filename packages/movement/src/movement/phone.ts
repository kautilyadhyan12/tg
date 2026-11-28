// The phone moved in a set (ROADMAP 53c; spec Part 2 §12.5, "As built, the phone moved in a set"). Every number the engine
// reads is a place on the picture, and a phone knocked, picked up or held by hand moves the whole picture: the person's
// still feet seem to travel and their place is somewhere else, so a squat is another movement and the lock (52d) refuses
// them for the rest of the set (53b-i, on the laptop: a squat's picture swaying as a hand does counted 3 of 3 at 0.2 cm of
// sway on an 11 cm person, 0 of 3 from 0.5 cm). This stage reads how far the phone itself turned, from its own gyroscope
// (`MovementFrame.spin`), and says, picture by picture:
//   - **moving**: the phone points elsewhere than a moment ago, or keeps turning (a hand holding it, a knock): nothing in
//     the picture is read, no count and no word but "Keep the phone still.";
//   - **again**: the phone stands still again after moving, or the camera gave no picture for long enough that it may have
//     been moved (Pause, the app away): from this picture the person is found afresh, as at the start of a set, and the
//     count goes on from where it was (CameraSet).
// A reference video carries no `spin` (its camera stands still), and a phone with no gyroscope says none: neither is ever
// moving. Pure: the frames' own times and the phone's own readings. Nothing in this is any exercise's own.
import type { Spin } from "@app/shared";

export interface PhoneLimits {
  /** The turning is read over this last stretch of the set, ms. */
  readonly window: number;
  /** Turned further than this over `window`, radians, the phone points elsewhere: it has moved. */
  readonly turned: number;
  /** Turning this far in all over `window`, radians, back and forth or not: it keeps moving. */
  readonly shake: number;
  /** Still again once it has turned no more than `steady` in all over each `window` for this long, ms. */
  readonly settle: number;
  readonly steady: number;
  /** No picture for this long, ms (Pause, the app away, a camera that stalled): the phone may have been moved meanwhile. */
  readonly stopped: number;
}

const DEGREE = Math.PI / 180;

/**
 * Where each number comes from (§12.5, "As built, the phone moved in a set"): Kd's phone's own gyroscope, read by the camera
 * module with its camera screen open (2026-11-28, test/phone-motion). Lying still on a desk it turned 0.06 to 0.09 degrees
 * in each half second (the gyroscope's own drift, about 0.14 a second) and 0.06 to 0.14 in all; once, unexplained, 0.6
 * degrees and 1.4 in all; with the desk tapped hard beside it, 0.18 in all. Held in a hand, 1 to 13 degrees in all in most
 * half seconds, its steadiest moments 0.4 to 0.7, never for a whole second. A turn of 1.5 degrees is where a squat's
 * picture starts to be another movement: 53b-i measured a sway of 0.2 cm on an 11 cm person kept every squat and 0.5 cm lost
 * every one, 1.8 and 4.5 in 100 of the body's height, 0.7 and 1.7 degrees of a body 1.7 m tall 2.5 m from the phone. So:
 * moving past 1.5 degrees turned or 3 degrees in all in half a second (the still phone's blip 0.4 and 0.5 of them), still
 * again after a whole second under 0.5 in all; played on those readings, the still phone is never moving, the phone is
 * moving 0.03 s after it was picked up and in every picture it was held, and stands again once, 1 s after it lay still. A
 * phone held from the start is caught 0.19 s after the set began in the middle case, 2.4 s in 95 cases of 100, 4.4 at most,
 * while the person sets up. `stopped`: a second with no picture, five or more lost at the camera's slowest 8 a second
 * (`SLOWEST_RATE`), is the camera off, not a slow picture.
 */
export const PHONE_LIMITS: PhoneLimits = {
  window: 500,
  turned: 1.5 * DEGREE,
  shake: 3 * DEGREE,
  settle: 1000,
  steady: 0.5 * DEGREE,
  stopped: 1000,
};

export interface PhoneFrame {
  /** The phone is moving: nothing in this picture is read. */
  readonly moving: boolean;
  /** From this picture the person is found afresh, the count going on: the phone stands again after moving, or the camera
   *  was off long enough that it may have been moved. */
  readonly again: boolean;
  /** How far the phone turned over the last `window`: net (where it points against where it pointed) and in all, radians;
   *  null for a reference video. */
  readonly turned: number | null;
  readonly path: number | null;
}

const STILL: PhoneFrame = { moving: false, again: false, turned: null, path: null };

export class PhoneMotion {
  private readonly limits: PhoneLimits;
  private lastT: number | null = null;
  private turns: { readonly t: number; readonly spin: Spin }[] = [];
  private moving = false;
  private stillSince: number | null = null;

  constructor(limits: PhoneLimits = PHONE_LIMITS) {
    this.limits = limits;
  }

  /** One picture: its time and how far the phone turned since the picture before (absent for a reference video; null when
   *  the phone could not say, which adds nothing). */
  next(t: number, spin: Spin | null | undefined): PhoneFrame {
    if (spin === undefined) return STILL;
    const last = this.lastT;
    // A picture with the same time decides nothing new; a clock that went back is a new set.
    if (last !== null && t < last) this.reset();
    if (last !== null && t === last) return this.frame(false);
    this.lastT = t;
    // The camera gave no picture for a while: whatever the phone did meanwhile is not known.
    if (last !== null && t - last > this.limits.stopped) {
      this.reset();
      this.lastT = t;
      return this.frame(true);
    }
    if (spin !== null) this.turns.push({ t, spin });
    this.turns = this.turns.filter((x) => x.t > t - this.limits.window);
    const { turned, path } = this.sums();
    if (!this.moving) {
      if (turned > this.limits.turned || path > this.limits.shake) {
        this.moving = true;
        this.stillSince = null;
      }
      return this.frame(false);
    }
    if (path > this.limits.steady) {
      this.stillSince = null;
      return this.frame(false);
    }
    this.stillSince ??= t;
    if (t - this.stillSince < this.limits.settle) return this.frame(false);
    this.moving = false;
    this.stillSince = null;
    this.turns = [];
    return this.frame(true);
  }

  private sums(): { turned: number; path: number } {
    let x = 0;
    let y = 0;
    let z = 0;
    let path = 0;
    for (const { spin } of this.turns) {
      x += spin[0];
      y += spin[1];
      z += spin[2];
      path += Math.hypot(spin[0], spin[1], spin[2]);
    }
    return { turned: Math.hypot(x, y, z), path };
  }

  private frame(again: boolean): PhoneFrame {
    const { turned, path } = this.sums();
    return { moving: this.moving, again, turned, path };
  }

  private reset(): void {
    this.lastT = null;
    this.turns = [];
    this.moving = false;
    this.stillSince = null;
  }
}
