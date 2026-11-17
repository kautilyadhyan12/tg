// The body's picture (spec Part 2 §12.2, stage 4): one fixed list of measures, the same for
// every exercise, taken from one frame of steady points. A movement (job 52a) is checked against
// these, never against the points, so the list is worked out once for a video.
//
// Every measure is read twice: on the flat picture, and from the pose model's 3D points.
// Neither is always the better. Measured on Kd's videos (2026-11-17): side on, the flat picture
// is the steadier, and the 3D points can be far off (the squat's straight arm reads 25° more bent
// in 3D); a part that points at the camera has no true shape on the flat picture (the lying man's
// trunk, seen from the head end of the bench, reads anything from 44° to 178° flat and about 90°
// in 3D). So both are kept, and each movement uses the one that is steadier from its own phone
// place.
//
// How sure: a measure is read only from points the possible-body check used. Each reading says
// how much of itself the flat picture shows (`shown`): the least share of its own length that
// any part it measures shows on the picture (its length on the picture against its length in 3D,
// which the model gives well even where it places the part wrongly in depth), parts laid end to
// end included (the trunk's two sides can each show well and together point at the camera); for
// a lean or a height, the share of "down" the picture shows; for a height, the body's line from
// its foot to its hips too. A part lying across the picture shows about all of it; one pointing
// at the camera, little. Below half, the flat reading is not given: the picture's own shake could
// turn the part any way. How much more a movement needs is the movement's own number (job 52a),
// since a flat reading measures only what lies across the picture: from the side, a knee's bend
// forward and back, never its sway towards the camera. Nothing here names an exercise.
//
// The conventions, every angle in degrees:
//   - a joint: the angle between its two parts, 180 straight (elbow: shoulder-elbow-wrist;
//     shoulder: hip-shoulder-elbow, 0 with the arm by the side; hip: shoulder-hip-knee; knee:
//     hip-knee-ankle; ankle: knee-ankle-toes);
//   - a lean: a limb's angle from hanging straight down (0 hanging, 90 level, 180 straight up);
//     the trunk's, hips to shoulders, from upright (0 upright, 90 lying);
//   - a height: how high a point is above the floor, along "down", in the body's own legs (hip
//     to knee to ankle), read while a foot is in view; the floor is where the lowest heel or toes
//     have been (`Floor`);
//   - a width: how far apart two points are, in the body's own trunks (shoulder to hip); the
//     flat picture shows it as much as it shows the body's own line from left to right (the
//     shoulders for the hands, the hips for the feet);
//   - left against right: the left's reading less the right's.
import { KP } from "@app/shared";
import { Memory } from "./memory.js";
import type { SteadyBody } from "./steady.js";

type Vec = readonly [number, number, number];

export type Unit = "degrees" | "legs" | "trunks";

export interface MeasureLimits {
  /** A flat reading is not given when a part it measures, or "down", shows on the picture at
   *  less than this share of its own length. */
  readonly shown: number;
  /** How long the body's own lengths are remembered, ms. */
  readonly lengthMemory: number;
  /** The floor moves up only once both feet have been seen above it this long, ms. */
  readonly floorRise: number;
  /** With no foot seen for this long, ms, the floor is forgotten. */
  readonly floorMemory: number;
}

/**
 * Where each number comes from. `shown`: a part shown at half its length turns twice as far on
 * the picture for the same shake as one lying across it, and further without limit as it points
 * at the camera. The memories: lengths over 3 s, as the possible-body check remembers bones; the
 * floor rises only after a second, longer than a body stays in the air in a jump of 1.1 m
 * (2·√(2·1.1/9.81) = 0.95 s); a floor with no foot seen for 3 s is forgotten.
 */
export const MEASURE_LIMITS: MeasureLimits = {
  shown: 0.5,
  lengthMemory: 3000,
  floorRise: 1000,
  floorMemory: 3000,
};

/** One measure in one frame. */
export interface Reading {
  /** On the flat picture; null when it cannot be read there, or the picture shows too little of it. */
  readonly flat: number | null;
  /** From the 3D points; null when it cannot be read. */
  readonly world: number | null;
  /** How much of it the flat picture shows, about 1 when it lies across the picture (a little
   *  more when the picture and the 3D points differ on a length); null when it cannot be told. */
  readonly shown: number | null;
}

// ── Geometry ───────────────────────────────────────────────────────────────────────────
const DEG = 180 / Math.PI;
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const size = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);

function unit(a: Vec): Vec | null {
  const n = size(a);
  return n > 0 && Number.isFinite(n) ? [a[0] / n, a[1] / n, a[2] / n] : null;
}

function between(u: Vec, v: Vec): number | null {
  const d = size(u) * size(v);
  if (!(d > 0) || !Number.isFinite(d)) return null;
  return Math.acos(Math.min(1, Math.max(-1, dot(u, v) / d))) * DEG;
}

/** The points a body stands on, and its hips. */
const FOOT_POINTS: readonly number[] = [KP.left_heel, KP.left_foot_index, KP.right_heel, KP.right_foot_index];
const HIPS: readonly number[] = [KP.left_hip, KP.right_hip];

/** A part of the body by its two ends, the same key whichever end comes first. */
const partKey = (a: number, b: number): number => Math.min(a, b) * 64 + Math.max(a, b);

// ── How a measure reads one space ──────────────────────────────────────────────────────
// Two spaces: the flat picture, in picture heights with x in true proportion and no depth; and
// the 3D points, in metres, placed where the picture has the body so its floor stays put.

class Space {
  /** The least share of its own length that a part read since this was last set to 1 shows on
   *  the picture; only the flat picture keeps it. */
  shown = 1;

  constructor(
    private readonly points: readonly (Vec | null)[],
    private readonly downward: Vec | null,
    /** How far along "down" the floor lies, in this space's units; null when not seen. */
    readonly floor: number | null,
    /** This space's units in a metre. */
    readonly perMetre: number,
    /** The body's own lengths, metres. */
    readonly leg: number | null,
    readonly trunk: number | null,
    /** For the flat picture: each part's own length in 3D, metres; this frame's 3D points; and
     *  how much of "down" the picture shows. */
    private readonly truth: {
      readonly length: (key: number) => number | null;
      readonly world: readonly (Vec | null)[];
      readonly downShown: number;
    } | null = null,
  ) {}

  point(i: number): Vec | null {
    return this.points[i] ?? null;
  }

  /** From one used point to another: a part whose direction is measured. */
  part(from: number, to: number): Vec | null {
    const a = this.point(from);
    const b = this.point(to);
    if (a === null || b === null) return null;
    const v = minus(b, a);
    if (this.truth !== null) {
      // A bone's own length, steadier than one frame's; any other line's, this frame's.
      const ta = this.truth.world[from] ?? null;
      const tb = this.truth.world[to] ?? null;
      const whole = this.truth.length(partKey(from, to)) ?? (ta === null || tb === null ? null : size(minus(tb, ta)));
      this.see(whole === null || !(whole > 0) ? 0 : size(v) / this.perMetre / whole);
    }
    return v;
  }

  /** The lowest used heel or toes in this frame, along "down"; null when no foot is seen. */
  lowestFoot(): number | null {
    const d = this.downward;
    if (d === null) return null;
    let lowest: number | null = null;
    let deepest = Number.NEGATIVE_INFINITY;
    for (const i of FOOT_POINTS) {
      const p = this.point(i);
      if (p !== null && dot(p, d) > deepest) {
        deepest = dot(p, d);
        lowest = i;
      }
    }
    return lowest;
  }

  /** The parts from each `from` to its `to` that are used, laid end to end: what the picture
   *  shows of the whole is noted too, since two parts it shows well can together point at the
   *  camera. Null when none is used. */
  sum(pairs: readonly (readonly [number, number])[]): Vec | null {
    let total: Vec = [0, 0, 0];
    let whole: Vec = [0, 0, 0];
    let used = 0;
    for (const [from, to] of pairs) {
      const v = this.part(from, to);
      if (v === null) continue;
      total = [total[0] + v[0], total[1] + v[1], total[2] + v[2]];
      const a = this.truth?.world[from] ?? null;
      const b = this.truth?.world[to] ?? null;
      if (a !== null && b !== null) whole = [whole[0] + b[0] - a[0], whole[1] + b[1] - a[1], whole[2] + b[2] - a[2]];
      used++;
    }
    if (used === 0) return null;
    if (this.truth !== null && used > 1) this.see(size(whole) > 0 ? size(total) / this.perMetre / size(whole) : 0);
    return total;
  }

  /** Notes how much of the body's own line from `from` to `to` the picture shows, nothing when
   *  it cannot be seen. */
  facing(from: number, to: number): void {
    if (this.truth !== null && this.part(from, to) === null) this.see(0);
  }

  down(): Vec | null {
    if (this.truth !== null) this.see(this.truth.downShown);
    return this.downward;
  }

  private see(share: number): void {
    this.shown = Math.min(this.shown, share);
  }
}

type Of = (s: Space) => number | null;

/** The angle at `b` between its parts to `a` and to `c`. */
const bend =
  (a: number, b: number, c: number): Of =>
  (s) => {
    const u = s.part(b, a);
    const v = s.part(b, c);
    return u === null || v === null ? null : between(u, v);
  };

/** A part's angle from hanging straight down. */
const hang =
  (from: number, to: number): Of =>
  (s) => {
    const v = s.part(from, to);
    const d = s.down();
    return v === null || d === null ? null : between(v, d);
  };

interface Side {
  readonly shoulder: number;
  readonly elbow: number;
  readonly wrist: number;
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  readonly heel: number;
  readonly toes: number;
}
const LEFT: Side = {
  shoulder: KP.left_shoulder,
  elbow: KP.left_elbow,
  wrist: KP.left_wrist,
  hip: KP.left_hip,
  knee: KP.left_knee,
  ankle: KP.left_ankle,
  heel: KP.left_heel,
  toes: KP.left_foot_index,
};
const RIGHT: Side = {
  shoulder: KP.right_shoulder,
  elbow: KP.right_elbow,
  wrist: KP.right_wrist,
  hip: KP.right_hip,
  knee: KP.right_knee,
  ankle: KP.right_ankle,
  heel: KP.right_heel,
  toes: KP.right_foot_index,
};
const SIDES: readonly Side[] = [LEFT, RIGHT];

/** Every part whose own length the measures need. */
const PARTS: readonly (readonly [number, number])[] = [
  ...SIDES.flatMap((s): (readonly [number, number])[] => [
    [s.shoulder, s.elbow],
    [s.elbow, s.wrist],
    [s.hip, s.knee],
    [s.knee, s.ankle],
    [s.ankle, s.toes],
    [s.hip, s.shoulder],
  ]),
  [KP.left_shoulder, KP.right_shoulder],
  [KP.left_hip, KP.right_hip],
];

/** The trunk's angle from upright: the side from hip to shoulder, of each side seen, together. */
const trunkLean: Of = (s) => {
  const d = s.down();
  const trunk = s.sum(SIDES.map((side) => [side.hip, side.shoulder] as const));
  return d === null || trunk === null ? null : between(trunk, [-d[0], -d[1], -d[2]]);
};

/** How high the middle of the used `points` is above the floor, in legs. Read only while a foot
 *  is in view, and on the flat picture only as much as the picture shows the body's own line from
 *  that foot to its hips: a foot far behind the hips, as from the head end of a bench, is not at
 *  the hips' distance from the phone, so the picture's one size does not hold between them. */
const height =
  (points: readonly number[]): Of =>
  (s) => {
    const d = s.down();
    const foot = s.lowestFoot();
    if (d === null || foot === null || s.floor === null || s.leg === null) return null;
    const hips = HIPS.filter((h) => s.point(h) !== null);
    if (hips.length === 0) s.facing(foot, KP.left_hip);
    for (const h of hips) s.part(foot, h);
    const along = points.flatMap((i) => {
      const p = s.point(i);
      return p === null ? [] : [dot(p, d)];
    });
    if (along.length === 0) return null;
    const middle = along.reduce((a, b) => a + b, 0) / along.length;
    return (s.floor - middle) / s.perMetre / s.leg;
  };

/** How far apart two points are, in trunks, as much as the body's line `across` shows. */
const apart =
  (a: number, b: number, across: readonly [number, number]): Of =>
  (s) => {
    const p = s.point(a);
    const q = s.point(b);
    if (p === null || q === null || s.trunk === null) return null;
    s.facing(across[0], across[1]);
    return size(minus(p, q)) / s.perMetre / s.trunk;
  };

const leftAgainstRight =
  (left: Of, right: Of): Of =>
  (s) => {
    const l = left(s);
    const r = right(s);
    return l === null || r === null ? null : l - r;
  };

function limb(side: Side) {
  return {
    elbow: bend(side.shoulder, side.elbow, side.wrist),
    shoulder: bend(side.hip, side.shoulder, side.elbow),
    hip: bend(side.shoulder, side.hip, side.knee),
    knee: bend(side.hip, side.knee, side.ankle),
    ankle: bend(side.knee, side.ankle, side.toes),
    upperArm: hang(side.shoulder, side.elbow),
    forearm: hang(side.elbow, side.wrist),
    thigh: hang(side.hip, side.knee),
    shin: hang(side.knee, side.ankle),
    wrist: height([side.wrist]),
    ankleUp: height([side.ankle]),
  };
}
const L = limb(LEFT);
const R = limb(RIGHT);

interface Measure {
  readonly name: string;
  readonly unit: Unit;
  readonly of: Of;
}

const DEFS = [
  { name: "left elbow", unit: "degrees", of: L.elbow },
  { name: "right elbow", unit: "degrees", of: R.elbow },
  { name: "left shoulder", unit: "degrees", of: L.shoulder },
  { name: "right shoulder", unit: "degrees", of: R.shoulder },
  { name: "left hip", unit: "degrees", of: L.hip },
  { name: "right hip", unit: "degrees", of: R.hip },
  { name: "left knee", unit: "degrees", of: L.knee },
  { name: "right knee", unit: "degrees", of: R.knee },
  { name: "left ankle", unit: "degrees", of: L.ankle },
  { name: "right ankle", unit: "degrees", of: R.ankle },
  { name: "trunk lean", unit: "degrees", of: trunkLean },
  { name: "left upper arm lean", unit: "degrees", of: L.upperArm },
  { name: "right upper arm lean", unit: "degrees", of: R.upperArm },
  { name: "left forearm lean", unit: "degrees", of: L.forearm },
  { name: "right forearm lean", unit: "degrees", of: R.forearm },
  { name: "left thigh lean", unit: "degrees", of: L.thigh },
  { name: "right thigh lean", unit: "degrees", of: R.thigh },
  { name: "left shin lean", unit: "degrees", of: L.shin },
  { name: "right shin lean", unit: "degrees", of: R.shin },
  { name: "hips height", unit: "legs", of: height([KP.left_hip, KP.right_hip]) },
  { name: "shoulders height", unit: "legs", of: height([KP.left_shoulder, KP.right_shoulder]) },
  { name: "left wrist height", unit: "legs", of: L.wrist },
  { name: "right wrist height", unit: "legs", of: R.wrist },
  { name: "left ankle height", unit: "legs", of: L.ankleUp },
  { name: "right ankle height", unit: "legs", of: R.ankleUp },
  { name: "hands apart", unit: "trunks", of: apart(KP.left_wrist, KP.right_wrist, [KP.left_shoulder, KP.right_shoulder]) },
  { name: "feet apart", unit: "trunks", of: apart(KP.left_ankle, KP.right_ankle, [KP.left_hip, KP.right_hip]) },
  { name: "elbows, left against right", unit: "degrees", of: leftAgainstRight(L.elbow, R.elbow) },
  { name: "shoulders, left against right", unit: "degrees", of: leftAgainstRight(L.shoulder, R.shoulder) },
  { name: "hips, left against right", unit: "degrees", of: leftAgainstRight(L.hip, R.hip) },
  { name: "knees, left against right", unit: "degrees", of: leftAgainstRight(L.knee, R.knee) },
  { name: "ankles, left against right", unit: "degrees", of: leftAgainstRight(L.ankle, R.ankle) },
  { name: "upper arms, left against right", unit: "degrees", of: leftAgainstRight(L.upperArm, R.upperArm) },
  { name: "forearms, left against right", unit: "degrees", of: leftAgainstRight(L.forearm, R.forearm) },
  { name: "thighs, left against right", unit: "degrees", of: leftAgainstRight(L.thigh, R.thigh) },
  { name: "shins, left against right", unit: "degrees", of: leftAgainstRight(L.shin, R.shin) },
  { name: "wrist heights, left against right", unit: "legs", of: leftAgainstRight(L.wrist, R.wrist) },
  { name: "ankle heights, left against right", unit: "legs", of: leftAgainstRight(L.ankleUp, R.ankleUp) },
] as const satisfies readonly Measure[];

export type MeasureName = (typeof DEFS)[number]["name"];

/** The fixed list, in order, with each measure's unit. */
export const MEASURE_LIST: readonly { readonly name: MeasureName; readonly unit: Unit }[] = DEFS.map((m) => ({ name: m.name, unit: m.unit }));

export interface MeasuredBody {
  readonly t: number;
  /** The body's own lengths, metres, the middle of the last few seconds; null while unknown. */
  readonly leg: number | null;
  readonly trunk: number | null;
  /** Every measure of the list, each read flat and in 3D. */
  readonly readings: ReadonlyMap<MeasureName, Reading>;
}

// ── The floor ──────────────────────────────────────────────────────────────────────────
const FEET: readonly (readonly number[])[] = [
  [LEFT.heel, LEFT.toes],
  [RIGHT.heel, RIGHT.toes],
];

/** Where the floor lies, along "down": the lowest a heel or toes has been. It moves down at once
 *  to a foot lower than it, and up only once BOTH feet have been seen above it, without a break,
 *  for longer than a jump: one foot seen above it may simply be lifted while the other, hidden,
 *  stands on it. */
class Floor {
  private level: number | null = null;
  private footSeen: number | null = null;
  private aboveSince: number | null = null;
  private aboveLevel = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.level = null;
    this.footSeen = null;
    this.aboveSince = null;
  }

  /** `feet`: for each foot, its lowest used point along "down", or null when not seen. */
  next(t: number, feet: readonly (number | null)[], limits: MeasureLimits): number | null {
    if (this.footSeen !== null && t - this.footSeen > limits.floorMemory) this.reset();
    const seen = feet.filter((f): f is number => f !== null);
    if (seen.length === 0) {
      this.aboveSince = null;
      return this.level;
    }
    this.footSeen = t;
    const lowest = Math.max(...seen);
    if (this.level === null || lowest >= this.level) {
      this.level = lowest;
      this.aboveSince = null;
    } else if (seen.length < FEET.length) {
      this.aboveSince = null;
    } else if (this.aboveSince === null) {
      this.aboveSince = t;
      this.aboveLevel = lowest;
    } else {
      this.aboveLevel = Math.max(this.aboveLevel, lowest);
      if (t - this.aboveSince >= limits.floorRise) {
        this.level = this.aboveLevel;
        this.aboveSince = null;
      }
    }
    return this.level;
  }
}

function lowestFeet(points: readonly (Vec | null)[], down: Vec | null): (number | null)[] {
  return FEET.map((foot) => {
    if (down === null) return null;
    const along = foot.flatMap((i) => {
      const p = points[i] ?? null;
      return p === null ? [] : [dot(p, down)];
    });
    return along.length === 0 ? null : Math.max(...along);
  });
}

// ── The measures of one body, frame by frame ───────────────────────────────────────────
export class BodyMeasures {
  private readonly limits: MeasureLimits;
  private lastT: number | null = null;
  private lengths = new Map<number, Memory>();
  private readonly flatFloor = new Floor();
  private readonly worldFloor = new Floor();

  constructor(limits: MeasureLimits = MEASURE_LIMITS) {
    this.limits = limits;
  }

  next(body: SteadyBody): MeasuredBody {
    const { t, aspect, size: perMetre, points } = body;
    const limits = this.limits;
    if (this.lastT !== null && t < this.lastT) {
      this.lengths = new Map();
      this.flatFloor.reset();
      this.worldFloor.reset();
    }
    this.lastT = t;

    // Each part's own length in 3D, the middle of the last few seconds.
    const world: (Vec | null)[] = points.map((p) => (p === null ? null : p.world));
    const middles = new Map<number, number>();
    for (const [a, b] of PARTS) {
      const key = partKey(a, b);
      const memory = this.lengths.get(key) ?? new Memory();
      this.lengths.set(key, memory);
      memory.forget(t - limits.lengthMemory);
      const p = world[a] ?? null;
      const q = world[b] ?? null;
      if (p !== null && q !== null) memory.add(t, size(minus(p, q)));
      const middle = memory.median();
      if (middle !== null) middles.set(key, middle);
    }
    const length = (key: number): number | null => middles.get(key) ?? null;
    const sideMean = (of: (side: Side) => number | null): number | null => {
      const each = SIDES.map(of).filter((v): v is number => v !== null);
      return each.length === 0 ? null : each.reduce((x, y) => x + y, 0) / each.length;
    };
    const leg = sideMean((s) => {
      const thigh = length(partKey(s.hip, s.knee));
      const shin = length(partKey(s.knee, s.ankle));
      return thigh === null || shin === null ? null : thigh + shin;
    });
    const trunk = sideMean((s) => length(partKey(s.hip, s.shoulder)));

    // Which way is down, in 3D and as the picture shows it.
    const down = body.down === null ? null : unit(body.down);
    const flatDown = down === null ? null : unit([down[0], down[1], 0]);
    const downShown = down === null ? 0 : Math.hypot(down[0], down[1]);

    // The flat picture, in picture heights; and the 3D points placed where the picture has the
    // body, so the floor stays put while the body moves over it.
    const flat: (Vec | null)[] | null = perMetre === null ? null : points.map((p) => (p === null ? null : [p.x * aspect, p.y, 0]));
    const offset = flat === null || perMetre === null ? null : placement(flat, world, perMetre);
    const placed: (Vec | null)[] = offset === null ? world : world.map((w) => (w === null ? null : [w[0] + offset[0], w[1] + offset[1], w[2]]));

    const flatSpace =
      flat === null || perMetre === null
        ? null
        : new Space(flat, flatDown, this.flatFloor.next(t, lowestFeet(flat, flatDown), limits), perMetre, leg, trunk, { length, world, downShown });
    // Without the body placed on the picture the 3D points have no floor: their heights wait.
    const worldFloor = offset === null ? null : this.worldFloor.next(t, lowestFeet(placed, down), limits);
    const worldSpace = new Space(placed, down, worldFloor, 1, leg, trunk);

    const readings = new Map<MeasureName, Reading>();
    for (const m of DEFS) {
      const inWorld = finite(m.of(worldSpace));
      let onPicture: number | null = null;
      let shown: number | null = null;
      if (flatSpace !== null) {
        flatSpace.shown = 1;
        const read = finite(m.of(flatSpace));
        if (read !== null) {
          shown = flatSpace.shown;
          if (shown >= limits.shown) onPicture = read;
        }
      }
      readings.set(m.name, { flat: onPicture, world: inWorld, shown });
    }
    return { t, leg, trunk, readings };
  }
}

function finite(v: number | null): number | null {
  return v !== null && Number.isFinite(v) ? v : null;
}

/** Where the picture has the body's 3D origin, metres across and down the picture: the mean,
 *  over the used points, of where the picture puts each less where the 3D points put it. */
function placement(flat: readonly (Vec | null)[], world: readonly (Vec | null)[], perMetre: number): Vec | null {
  let x = 0;
  let y = 0;
  let n = 0;
  flat.forEach((p, i) => {
    const w = world[i] ?? null;
    if (p === null || w === null) return;
    x += p[0] / perMetre - w[0];
    y += p[1] / perMetre - w[1];
    n++;
  });
  return n === 0 ? null : [x / n, y / n, 0];
}
