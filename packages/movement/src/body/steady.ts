// Steady points (spec Part 2 §12.2, stage 3). The pose model's points shake a little from
// frame to frame even on a body standing still; a steady point is the used point with that
// shake taken out, so a later measure does not flicker. It is the one-euro filter (Casiez,
// Roussel and Vogel, CHI 2012): strong smoothing while a point is nearly still, little while
// it moves fast, so a real movement is not trailed. It works on the times of the frames, never
// on a count of them, so a slow phone and a fast one give the same steady points.
//
// Only a used point gets a steady value. A refused point has none, and once it is used again
// its smoothing starts afresh from where it is, never from where it was before.
import type { Down, WorldPoint } from "@app/shared";
import { POINTS } from "./points.js";
import type { CheckedBody, Refusal } from "./possible.js";

/** One filter's two settings: the smoothing at rest (Hz; lower is steadier) and how fast it
 *  loosens as the point speeds up (Hz for each metre a second). */
export interface Smoothing {
  readonly minCutoff: number;
  readonly beta: number;
}
export interface SteadySettings {
  /** The points on the picture. */
  readonly flat: Smoothing;
  /** The 3D points. */
  readonly world: Smoothing;
  /** How the speed itself is smoothed (Hz): 1, as the filter's authors advise. */
  readonly speedCutoff: number;
}

/** Set by `body-check` from Kd's reference videos as the phone's own model reads them, asked for
 *  one person (51c; `scripts/bodyCheck.ts` says the rule): the steadiest settings that keep a
 *  moving joint, on average, within 1 cm more than the model's own shake already puts it. On the
 *  four of his videos that set numbers they take out 21 to 54 in 100 of the shake of a used big
 *  joint on the picture and 32 to 73 in 3D (the middle shake, moving or not). */
export const STEADY: SteadySettings = {
  flat: { minCutoff: 2, beta: 10 },
  world: { minCutoff: 0.05, beta: 20 },
  speedCutoff: 1,
};

export interface SteadyPoint {
  /** Shares of the picture's width and height, as the model gives them. */
  readonly x: number;
  readonly y: number;
  /** Metres, centred between the hips. */
  readonly world: WorldPoint;
}

export interface SteadyBody {
  readonly t: number;
  readonly aspect: number;
  readonly down: Down | null;
  readonly size: number | null;
  /** For each of the 33 points: its steady value, or null exactly when it is refused. */
  readonly points: readonly (SteadyPoint | null)[];
  readonly refused: readonly (Refusal | null)[];
}

/** The share of a new value a filter takes at this cut-off, for a step of `seconds`. */
function share(cutoff: number, seconds: number): number {
  const r = 2 * Math.PI * cutoff * seconds;
  return r / (r + 1);
}

/** One point's one-euro filter, over all its numbers at once (two on the picture, three in 3D). */
class OneEuro {
  private value: number[] | null = null;
  private slope: number[] = [];
  private t = 0;

  constructor(
    private readonly smoothing: Smoothing,
    private readonly speedCutoff: number,
  ) {}

  reset(): void {
    this.value = null;
  }

  /** `perMetre`: how many of the numbers' own units make a metre, so the speed is metres a second. */
  next(t: number, raw: readonly number[], perMetre: number): number[] {
    const before = this.value;
    if (before === null) {
      this.value = [...raw];
      this.slope = raw.map(() => 0);
      this.t = t;
      return [...raw];
    }
    const seconds = (t - this.t) / 1000;
    this.t = t;
    const slopeShare = share(this.speedCutoff, seconds);
    const slope = raw.map((v, k) => slopeShare * ((v - (before[k] ?? v)) / seconds) + (1 - slopeShare) * (this.slope[k] ?? 0));
    this.slope = slope;
    const speed = Math.hypot(...slope) / perMetre;
    const valueShare = share(this.smoothing.minCutoff + this.smoothing.beta * speed, seconds);
    const value = raw.map((v, k) => valueShare * v + (1 - valueShare) * (before[k] ?? v));
    this.value = value;
    return [...value];
  }
}

export class SteadyPoints {
  private readonly flat: OneEuro[];
  private readonly world: OneEuro[];
  private aspect: number | null = null;

  constructor(settings: SteadySettings = STEADY) {
    this.flat = Array.from({ length: POINTS }, () => new OneEuro(settings.flat, settings.speedCutoff));
    this.world = Array.from({ length: POINTS }, () => new OneEuro(settings.world, settings.speedCutoff));
  }

  next(body: CheckedBody): SteadyBody {
    const { t, aspect, down, size, person, refused } = body;
    if (this.aspect !== aspect) {
      for (const f of [...this.flat, ...this.world]) f.reset();
      this.aspect = aspect;
    }
    const points: (SteadyPoint | null)[] = [];
    for (let i = 0; i < POINTS; i++) {
      const flat = this.flat[i];
      const world = this.world[i];
      const seen = person?.points[i];
      const seen3d = person?.world?.[i];
      if (flat === undefined || world === undefined) continue;
      if (refused[i] !== null || seen === undefined || seen3d === undefined || size === null) {
        flat.reset();
        world.reset();
        points.push(null);
        continue;
      }
      const [x = 0, y = 0] = flat.next(t, [seen[0] * aspect, seen[1]], size);
      const [wx = 0, wy = 0, wz = 0] = world.next(t, seen3d, 1);
      points.push({ x: x / aspect, y, world: [wx, wy, wz] });
    }
    return { t, aspect, down, size, points, refused };
  }
}
