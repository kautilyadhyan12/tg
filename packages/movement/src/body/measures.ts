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
// any part it measures shows on the picture (its length on the picture against its length in 3D),
// parts laid end to end included (the trunk's two sides can each show well and together point at
// the camera); for a lean or a height, the share of "down" the picture shows; for a height, the
// body's lines from its foot to its hips and on to the points; for a width, the line between the
// two points and the body's own line across. Below half, the flat reading is not given: the
// picture's own shake could turn the part any way. Above half a share proves nothing: two parts
// each shown 0.94 of themselves can bend 40° towards the camera and look straight, and on Kd's
// videos one part in ten reads 17 to 43 in 100 longer on the picture than in 3D, so a share of 1
// can hide a turn. So a flat reading is also given only while it lies within the limit of its 3D
// reading (`off`): the two models must agree, within the 3D points' own error where the parts lie
// across the picture. How sure a movement needs a reading is its own number (job 52a). Nothing
// here names an exercise.
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
//     shoulders for the hands, the hips for the feet and the knees);
//   - left against right: the left's reading less the right's.
import { KP } from "@app/shared";
import { LongMemory, Memory } from "./memory.js";
import type { SteadyBody } from "./steady.js";

type Vec = readonly [number, number, number];

export type Unit = "degrees" | "legs" | "trunks";

export interface MeasureLimits {
  /** A flat reading is not given when a part it measures, or "down", shows on the picture at
   *  less than this share of its own length. */
  readonly shown: number;
  /** A flat angle is not given when it lies further than this from its 3D reading, degrees
   *  (`Reading.off`). */
  readonly angle: number;
  /** A flat height or width is not given when it lies further than this from its 3D reading, in
   *  its own unit (legs or trunks). */
  readonly length: number;
  /** The floor is set afresh when the body's size on the picture has changed by more than this
   *  share since it was set: the body moved nearer the phone or further from it. */
  readonly sizeChange: number;
  /** How long each part's own length is remembered for how much of it the picture shows, ms; and a body whose leg and
   *  trunk have not been read for this long is taken afresh, as the possible-body check takes a new body. */
  readonly lengthMemory: number;
  /** How long the body's own leg and trunk are remembered, ms: longer than a set, since they do not change. */
  readonly ownMemory: number;
  /** The body's own leg is read only while its knee is within this of straight in 3D, degrees: a bent leg's 3D length
   *  reads short. */
  readonly straightKnee: number;
  /** The floor is the middle of where the lowest foot stood over this long, ms: it moves to where the feet now stand
   *  only once they have stood there for more than half of it. */
  readonly floorWindow: number;
  /** The floor moves at once to feet that have stood still off it this long, ms, within a foot lifted of one height,
   *  every knee seen straight (a step, or walking back from the phone). */
  readonly floorStill: number;
  /** A foot this share of a leg above the floor or less still stands on it; and one foot seen above the floor whose drop below the hips (3D) has shrunk by less than this
   *  share of a leg since it last stood on the floor was not lifted: the body moved. */
  readonly footLift: number;
  /** With no foot seen for this long, ms, the floor is forgotten. */
  readonly floorMemory: number;
}

/**
 * Where each number comes from. `shown`: a part shown at half its length turns twice as far on
 * the picture for the same shake as one lying across it, and further without limit as it points
 * at the camera. `angle`, `length` and `sizeChange`: set by `measure-check` from Kd's videos that
 * set numbers (`scripts/measureCheck.ts` says the rules): where the picture shows the parts and lines
 * lying across it, the flat and 3D readings differ by up to these in 95 frames of 100 (the 3D
 * points' own error; side on, the squat's arms 25° and its hip about 9°); the body's size on the
 * picture changes by up to about a tenth while a person stays in place. `footLift`: a twentieth
 * of a leg, about 4 cm, just above how much a standing foot's drop below the hips shakes in 3D
 * (on the squat video, 0.042 of a leg in 95 frames of 100, 0.048 at most); a shakier frame only
 * delays the floor, and a foot lifted by less, taken for a step, moves it by less than half of
 * what a height may be off. The memories: each part's length over 3 s, as the
 * possible-body check remembers bones; the floor is the middle of the last 2 s, so it moves only
 * once the feet have stood elsewhere for more than a second, longer than a body stays in the air
 * in a jump of 1.1 m (2·√(2·1.1/9.81) = 0.95 s); a floor with no foot seen for 3 s is forgotten. The body's own leg and trunk (52a-ii-b-i): the middle of every reading of
 * them in the last minute, each side's reading in each frame one reading, and the leg only while
 * the knee is within 30° of straight. Measured on a man's own videos with the phone on the floor
 * (2026-11-20): held over the last 3 s from both sides' middles, his leg spread 37% (2nd to 98th
 * hundredth, the first 4 s left out) and his trunk 22% on one video, as the far leg, seen at the
 * bottom of a squat with its 3D thigh 0.28 m against 0.41 standing, came and went; held this way
 * his leg spreads 1 to 3% on his three squat videos and 0 to 2% on the squat videos of 52a, his
 * trunk at most 6%. A bent leg reads short in 3D (his thighs at the bottom of a squat from the
 * front 0.29 to 0.31 m, standing 0.39 to 0.43), so until the leg has been seen straight its
 * middle over every reading stands in.
 */
export const MEASURE_LIMITS: MeasureLimits = {
  shown: 0.5,
  angle: 30,
  length: 0.15,
  sizeChange: 0.15,
  lengthMemory: 3000,
  ownMemory: 60000,
  straightKnee: 30,
  floorWindow: 2000,
  floorStill: 300,
  footLift: 0.05,
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
  /** In its own unit: how far the flat reading lies from the 3D one, given or not (a height
   *  compared above the foot seen in that frame, in both). Null when either cannot be read. */
  readonly off: number | null;
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
/** A line shorter than this share of the trunk has no direction worth judging. */
const LINE_LEAST = 0.1;

/** A part of the body by its two ends, the same key whichever end comes first. */
const partKey = (a: number, b: number): number => Math.min(a, b) * 64 + Math.max(a, b);

// ── How a measure reads one space ──────────────────────────────────────────────────────
// Two spaces: the flat picture, in picture heights with x in true proportion and no depth; and
// the 3D points, in metres, placed where the picture has the body so its floor stays put.

class Space {
  /** The least share of its own length that a part or line read since `reset` shows on the
   *  picture; only the flat picture keeps it. */
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

  reset(): void {
    this.shown = 1;
  }

  point(i: number): Vec | null {
    return this.points[i] ?? null;
  }

  /** From one used point to another: a part whose direction is measured. */
  part(from: number, to: number): Vec | null {
    const v = this.vector(from, to);
    if (v !== null) this.noteLine(from, to, v);
    return v;
  }

  /** The parts from each `from` to its `to` that are used, laid end to end. What the picture
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
    if (this.truth !== null && used > 1) this.note(size(whole) > 0 ? size(total) / this.perMetre / size(whole) : 0);
    return total;
  }

  /** Notes how much of the body's own line from `from` to `to` the picture shows, nothing when
   *  it cannot be seen. */
  facing(from: number, to: number): void {
    if (this.truth === null) return;
    const v = this.vector(from, to);
    if (v === null) this.note(0);
    else this.noteLine(from, to, v);
  }

  /** Whether the 3D points put `a` and `b` at least `least` metres apart this frame; only the
   *  flat picture can say. */
  apartIn3D(a: number, b: number, least: number): boolean {
    const p = this.truth?.world[a] ?? null;
    const q = this.truth?.world[b] ?? null;
    return p !== null && q !== null && size(minus(p, q)) >= least;
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

  down(): Vec | null {
    if (this.truth !== null) this.note(this.truth.downShown);
    return this.downward;
  }

  private vector(from: number, to: number): Vec | null {
    const a = this.point(from);
    const b = this.point(to);
    return a === null || b === null ? null : minus(b, a);
  }

  /** A bone's own length is steadier than one frame's; any other line's is this frame's. */
  private noteLine(from: number, to: number, v: Vec): void {
    if (this.truth === null) return;
    const ta = this.truth.world[from] ?? null;
    const tb = this.truth.world[to] ?? null;
    const whole = this.truth.length(partKey(from, to)) ?? (ta === null || tb === null ? null : size(minus(tb, ta)));
    this.note(whole === null || !(whole > 0) ? 0 : size(v) / this.perMetre / whole);
  }

  private note(share: number): void {
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
 *  is in view, and on the flat picture only as much as the picture shows the body's own lines
 *  from that foot to its hips and from its hips to the points: a foot far behind the hips, as
 *  from the head end of a bench, or a hand reaching to the phone, is not at the hips' distance
 *  from the phone, so the picture's one size does not hold between them. */
const height =
  (points: readonly number[]): Of =>
  (s) => {
    const d = s.down();
    const foot = s.lowestFoot();
    if (d === null || foot === null || s.floor === null || s.leg === null) return null;
    const hips = HIPS.filter((h) => s.point(h) !== null);
    if (hips.length === 0) s.facing(foot, KP.left_hip);
    for (const h of hips) {
      s.facing(foot, h);
      for (const i of points) if (!HIPS.includes(i) && s.point(i) !== null) s.facing(h, i);
    }
    const along = points.flatMap((i) => {
      const p = s.point(i);
      return p === null ? [] : [dot(p, d)];
    });
    if (along.length === 0) return null;
    const middle = along.reduce((a, b) => a + b, 0) / along.length;
    return (s.floor - middle) / s.perMetre / s.leg;
  };

/** The same height above the lowest foot seen in this frame, not above the remembered floor: how
 *  a flat height is checked against the 3D one. The 3D points' floor is placed by the picture and
 *  remembered, so comparing the two remembered floors would test the memory, not the picture. */
const heightNow =
  (points: readonly number[]): Of =>
  (s) => {
    const d = s.down();
    const foot = s.lowestFoot();
    const f = foot === null ? null : s.point(foot);
    if (d === null || f === null || s.leg === null) return null;
    const along = points.flatMap((i) => {
      const p = s.point(i);
      return p === null ? [] : [dot(p, d)];
    });
    if (along.length === 0) return null;
    return (dot(f, d) - along.reduce((a, b) => a + b, 0) / along.length) / s.perMetre / s.leg;
  };

/** How far apart two points are, in trunks. On the flat picture only as much as the picture
 *  shows the body's own line from left to right `across`, the line between the two points (once
 *  the 3D points put them more than a tenth of a trunk apart, about 5 cm, five times a joint's
 *  shake: nearer, its direction is the shake's), and the lines from the hips to them (a foot far
 *  nearer the phone than the hips is not at their distance, so the picture's one size does not
 *  hold). */
const apart =
  (a: number, b: number, across: readonly [number, number]): Of =>
  (s) => {
    const p = s.point(a);
    const q = s.point(b);
    if (p === null || q === null || s.trunk === null) return null;
    s.facing(across[0], across[1]);
    if (s.apartIn3D(a, b, LINE_LEAST * s.trunk)) s.facing(a, b);
    for (const h of HIPS) {
      if (s.point(h) === null) continue;
      s.facing(h, a);
      s.facing(h, b);
    }
    return size(minus(p, q)) / s.perMetre / s.trunk;
  };

/** How far apart the hips are, in trunks: the body's own line from left to right. On the flat picture only as much as
 *  the picture shows that line: side on it points at the phone, and its share tells how far the body is turned. */
const across =
  (a: number, b: number): Of =>
  (s) => {
    const p = s.point(a);
    const q = s.point(b);
    if (p === null || q === null || s.trunk === null) return null;
    s.facing(a, b);
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
    wristNow: heightNow([side.wrist]),
    ankleNow: heightNow([side.ankle]),
  };
}
const L = limb(LEFT);
const R = limb(RIGHT);

interface Measure {
  readonly name: string;
  readonly unit: Unit;
  readonly of: Of;
  /** What the flat and 3D readings are compared by, when not `of` itself. */
  readonly check?: Of;
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
  { name: "hips height", unit: "legs", of: height([KP.left_hip, KP.right_hip]), check: heightNow([KP.left_hip, KP.right_hip]) },
  { name: "shoulders height", unit: "legs", of: height([KP.left_shoulder, KP.right_shoulder]), check: heightNow([KP.left_shoulder, KP.right_shoulder]) },
  { name: "left wrist height", unit: "legs", of: L.wrist, check: L.wristNow },
  { name: "right wrist height", unit: "legs", of: R.wrist, check: R.wristNow },
  { name: "left ankle height", unit: "legs", of: L.ankleUp, check: L.ankleNow },
  { name: "right ankle height", unit: "legs", of: R.ankleUp, check: R.ankleNow },
  { name: "hands apart", unit: "trunks", of: apart(KP.left_wrist, KP.right_wrist, [KP.left_shoulder, KP.right_shoulder]) },
  { name: "feet apart", unit: "trunks", of: apart(KP.left_ankle, KP.right_ankle, [KP.left_hip, KP.right_hip]) },
  { name: "knees apart", unit: "trunks", of: apart(KP.left_knee, KP.right_knee, [KP.left_hip, KP.right_hip]) },
  { name: "hips apart", unit: "trunks", of: across(KP.left_hip, KP.right_hip) },
  { name: "elbows, left against right", unit: "degrees", of: leftAgainstRight(L.elbow, R.elbow) },
  { name: "shoulders, left against right", unit: "degrees", of: leftAgainstRight(L.shoulder, R.shoulder) },
  { name: "hips, left against right", unit: "degrees", of: leftAgainstRight(L.hip, R.hip) },
  { name: "knees, left against right", unit: "degrees", of: leftAgainstRight(L.knee, R.knee) },
  { name: "ankles, left against right", unit: "degrees", of: leftAgainstRight(L.ankle, R.ankle) },
  { name: "upper arms, left against right", unit: "degrees", of: leftAgainstRight(L.upperArm, R.upperArm) },
  { name: "forearms, left against right", unit: "degrees", of: leftAgainstRight(L.forearm, R.forearm) },
  { name: "thighs, left against right", unit: "degrees", of: leftAgainstRight(L.thigh, R.thigh) },
  { name: "shins, left against right", unit: "degrees", of: leftAgainstRight(L.shin, R.shin) },
  { name: "wrist heights, left against right", unit: "legs", of: leftAgainstRight(L.wrist, R.wrist), check: leftAgainstRight(L.wristNow, R.wristNow) },
  { name: "ankle heights, left against right", unit: "legs", of: leftAgainstRight(L.ankleUp, R.ankleUp), check: leftAgainstRight(L.ankleNow, R.ankleNow) },
] as const satisfies readonly Measure[];

export type MeasureName = (typeof DEFS)[number]["name"];

/** The fixed list, in order, with each measure's unit. */
export const MEASURE_LIST: readonly { readonly name: MeasureName; readonly unit: Unit }[] = DEFS.map((m) => ({ name: m.name, unit: m.unit }));

export interface MeasuredBody {
  readonly t: number;
  /** The body's own lengths, metres, the middle of the last minute (the leg only while straight; `own`); null while unknown. */
  readonly leg: number | null;
  readonly trunk: number | null;
  /** The feet stand on the floor line on the picture: the lowest foot seen lies within a foot lifted (`footLift`) of it.
   *  False while the floor is still moving to where the feet now stand (a person walking back from the phone), with no
   *  foot seen, or no floor yet: a standing taken then would put every height after it off. */
  readonly onFloor: boolean;
  /** Every measure of the list, each read flat and in 3D. */
  readonly readings: ReadonlyMap<MeasureName, Reading>;
}

// ── The floor ──────────────────────────────────────────────────────────────────────────
const FEET: readonly (readonly number[])[] = [
  [LEFT.heel, LEFT.toes],
  [RIGHT.heel, RIGHT.toes],
];

/** Where the floor lies, along "down": the middle of where the lowest heel or toes stood over the
 *  last `floorWindow` (52a-ii-b-i), never the one lowest reading. Near the floor the pose model's
 *  foot points wander: on a man's own videos with the phone on the floor, his heel and toes slid 4 to
 *  5 cm down the picture together on the way down and up of each squat, and a toe point lay 9 cm
 *  down on the floor's reflection; a floor taken at once from the lowest of them lay up to 8 cm
 *  under his feet while he stood. So a foot point under the floor never moves it by itself: the
 *  floor moves to where the feet stand only once they have stood there for most of the window,
 *  longer than a body stays up in a jump. A frame's lowest foot counts where the feet stood when it
 *  is on the floor, under it, or above it by less than a foot lifted (`lift`); above it by more, only
 *  when it shows that the body moved rather than a foot lifted: both feet seen above it, or each
 *  foot seen as far below the hips in 3D as when it last stood on the floor (a step back from the
 *  phone moves the whole body up the picture and leaves the legs as they were). One foot seen
 *  higher and nearer its hips is lifted, while the other, perhaps hidden, stands on the floor. A
 *  step down, or nearer the phone, moves the floor down at once when two signs agree that the whole
 *  body went lower: each foot seen as far below the hips in 3D as when it last stood, and the
 *  lowest foot as far below the hips in this space too (a foot point sliding down the picture
 *  leaves the hips where they were; a body bending brings its hips nearer its feet in both). */
class Floor {
  private level: number | null = null;
  /** The body's size on the picture when the feet last stood on the floor. */
  private size: number | null = null;
  private footSeen: number | null = null;
  /** For each foot, how far below the hips it was in 3D, metres, when it last stood on the floor. */
  private standing: (number | null)[] = FEET.map(() => null);
  /** How far the lowest foot lay below the hips in this space when the feet last stood on the floor. */
  private span: number | null = null;
  /** Where the lowest foot stood, frame by frame, over the last `floorWindow`. */
  private readonly stood = new LongMemory();
  /** The lowest foot seen in the last frame stood within a foot lifted of the floor. */
  settled = false;
  /** Since when the lowest foot has stood still off the floor line, and where; null while it has not. */
  private stillAbove: { readonly since: number; readonly level: number } | null = null;

  reset(): void {
    this.level = null;
    this.size = null;
    this.footSeen = null;
    this.standing = FEET.map(() => null);
    this.span = null;
    this.stillAbove = null;
    this.stood.clear();
  }

  /** `feet`: for each foot, its lowest used point along "down", or null when not seen; `drops`:
   *  for each foot, how far below the hips it is in 3D now, metres, or null; `size`: the body's
   *  size on the picture now; `unit`: this space's units in a metre; `hips`: the middle of the used
   *  hips along "down" in this space, or null; `lift`: the least shrinking of a drop, metres, that is
   *  a foot lifted (null when the body's leg is not known yet); `tall`: every knee seen is within `straightKnee` of straight
   *  in 3D, at least one seen. A body that
   *  moved nearer the phone or further from it by more than `sizeChange` stands on another line of
   *  the picture: the floor is set afresh from the feet seen. */
  next(
    t: number,
    feet: readonly (number | null)[],
    drops: readonly (number | null)[],
    size: number,
    unit: number,
    hips: number | null,
    lift: number | null,
    limits: MeasureLimits,
    tall = false,
  ): number | null {
    if (this.footSeen !== null && t - this.footSeen > limits.floorMemory) this.reset();
    if (this.size !== null && Math.abs(size / this.size - 1) > limits.sizeChange) this.reset();
    this.stood.forget(t - limits.floorWindow);
    this.settled = false;
    const seen = feet.flatMap((f, k) => (f === null ? [] : [k]));
    if (seen.length === 0) return this.level;
    this.footSeen = t;
    const lowest = Math.max(...seen.map((k) => feet[k] ?? Number.NEGATIVE_INFINITY));
    const band = lift === null ? 0 : lift * unit;
    // How far under the floor the lowest foot is, along "down"; above it when below 0.
    const under = this.level === null ? 0 : lowest - this.level;
    // Each foot seen is as far below the hips in 3D as when it last stood on the floor: the body moved, not a foot.
    const asStanding = seen.every((k) => {
      const now = drops[k] ?? null;
      const then = this.standing[k] ?? null;
      return lift !== null && now !== null && then !== null && now >= then - lift;
    });
    const span = this.span;
    const steppedDown = under > band && asStanding && hips !== null && span !== null && Math.abs(lowest - hips - span) <= band;
    // A step, or walking back from the phone and turning: the feet stand higher or lower on the picture, the legs straight.
    // Once they have stood still there, within a foot lifted, for `floorStill`, the floor is where they stand, at once: a
    // body in the air is never that still (its feet stay within a foot lifted either side of one height at most
    // (1 + √2)·√(2 · lift / g): 0.22 s with a 0.84 m leg, 0.24 s with 1.0 m, 0.27 s with 1.2 m, 0.30 s only with 1.5 m; a
    // little longer where the picture shortens how far the body rises, a phone tilted up at it), and at the bottom of a
    // squat, or with a foot lifted, a knee is bent. (Not the foot's 3D drop: turning, a man stood with his knee at 170°
    // instead of 179°, his foot 5 cm nearer his hips in 3D.)
    const still = this.stillAbove;
    if (Math.abs(under) > band && tall) {
      if (still === null || Math.abs(lowest - still.level) > band) this.stillAbove = { since: t, level: lowest };
    } else {
      this.stillAbove = null;
    }
    const steppedAside = this.stillAbove !== null && t - this.stillAbove.since >= limits.floorStill;
    // On the floor, or under it (it then moves only once the feet have stood lower for most of the window, or at once
    // after a step down); above it by more than a foot lifted, only when the body moved.
    const onFloor = under >= -band;
    if (steppedDown || steppedAside) {
      this.stood.clear();
      this.stillAbove = null;
      this.level = lowest;
    }
    if (onFloor || seen.length === FEET.length || asStanding) {
      this.stood.add(t, lowest);
      this.size = size;
    }
    this.level = this.stood.median() ?? this.level;
    this.settled = this.level !== null && Math.abs(lowest - this.level) <= band;
    // Where the feet stand on the floor is learned only from feet on it, never from a foot under it.
    if (Math.abs(under) <= band || steppedDown || steppedAside) this.stand(seen, feet, drops, lift, hips === null ? null : lowest - hips);
    return this.level;
  }

  /** Keeps how far below the hips each foot on the floor is: the lowest foot on the picture, and
   *  every other foot seen whose drop in 3D is within `lift` of its. Two feet on the floor drop
   *  alike in 3D wherever they lie on the picture: side on, the far foot is higher on it. */
  private stand(seen: readonly number[], feet: readonly (number | null)[], drops: readonly (number | null)[], lift: number | null, span: number | null): void {
    if (span !== null) this.span = span;
    let ref = seen[0] ?? -1;
    for (const k of seen) if ((feet[k] ?? Number.NEGATIVE_INFINITY) > (feet[ref] ?? Number.NEGATIVE_INFINITY)) ref = k;
    const deepest = drops[ref] ?? null;
    for (const k of seen) {
      const drop = drops[k] ?? null;
      if (k === ref || (drop !== null && deepest !== null && lift !== null && drop >= deepest - lift)) this.standing[k] = drop;
    }
  }
}

/** For each foot, how far its lowest used point lies below the middle of the used hips, along
 *  "down" in 3D, metres; null when the foot, the hips or "down" are not known. */
function footDrops(world: readonly (Vec | null)[], down: Vec | null): (number | null)[] {
  const hips = HIPS.flatMap((h) => {
    const p = world[h] ?? null;
    return p === null ? [] : [p];
  });
  if (down === null || hips.length === 0) return FEET.map(() => null);
  const hip = hips.reduce((a, b) => dot(b, down) + a, 0) / hips.length;
  return FEET.map((foot) => {
    const along = foot.flatMap((i) => {
      const p = world[i] ?? null;
      return p === null ? [] : [dot(p, down)];
    });
    return along.length === 0 ? null : Math.max(...along) - hip;
  });
}

/** The middle of the used hips along "down"; null when neither hip or "down" is known. */
function hipsAlong(points: readonly (Vec | null)[], down: Vec | null): number | null {
  if (down === null) return null;
  const along = HIPS.flatMap((h) => {
    const p = points[h] ?? null;
    return p === null ? [] : [dot(p, down)];
  });
  return along.length === 0 ? null : along.reduce((a, b) => a + b, 0) / along.length;
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
  private readonly straightLegs = new LongMemory();
  private readonly anyLegs = new LongMemory();
  private readonly trunks = new LongMemory();

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
      for (const m of [this.straightLegs, this.anyLegs, this.trunks]) m.clear();
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
    const { leg, trunk } = this.own(t, world);

    // Which way is down, in 3D and as the picture shows it.
    const down = body.down === null ? null : unit(body.down);
    const flatDown = down === null ? null : unit([down[0], down[1], 0]);
    const downShown = down === null ? 0 : Math.hypot(down[0], down[1]);

    // The flat picture, in picture heights; and the 3D points placed where the picture has the
    // body, so the floor stays put while the body moves over it.
    const flat: (Vec | null)[] | null = perMetre === null ? null : points.map((p) => (p === null ? null : [p.x * aspect, p.y, 0]));
    const offset = flat === null || perMetre === null ? null : placement(flat, world, perMetre);
    const placed: (Vec | null)[] = offset === null ? world : world.map((w) => (w === null ? null : [w[0] + offset[0], w[1] + offset[1], w[2]]));

    const drops = footDrops(world, down);
    const knees = SIDES.flatMap((side) => {
      const hip = world[side.hip] ?? null;
      const knee = world[side.knee] ?? null;
      const ankle = world[side.ankle] ?? null;
      const angle = hip === null || knee === null || ankle === null ? null : between(minus(hip, knee), minus(ankle, knee));
      return angle === null ? [] : [angle];
    });
    const tall = knees.length > 0 && knees.every((a) => a >= 180 - limits.straightKnee);
    const lift = leg === null ? null : limits.footLift * leg;
    const flatSpace =
      flat === null || perMetre === null
        ? null
        : new Space(flat, flatDown, this.flatFloor.next(t, lowestFeet(flat, flatDown), drops, perMetre, perMetre, hipsAlong(flat, flatDown), lift, limits, tall), perMetre, leg, trunk, {
            length,
            world,
            downShown,
          });
    // Without the body placed on the picture the 3D points have no floor: their heights wait.
    const worldFloor =
      offset === null || perMetre === null ? null : this.worldFloor.next(t, lowestFeet(placed, down), drops, perMetre, 1, hipsAlong(placed, down), lift, limits, tall);
    const worldSpace = new Space(placed, down, worldFloor, 1, leg, trunk);

    const readings = new Map<MeasureName, Reading>();
    for (const m of DEFS) {
      const measure: Measure = m;
      const inWorld = finite(measure.of(worldSpace));
      let onPicture: number | null = null;
      let shown: number | null = null;
      let off: number | null = null;
      if (flatSpace !== null) {
        flatSpace.reset();
        const read = finite(measure.of(flatSpace));
        if (read !== null) {
          shown = flatSpace.shown;
          const check = measure.check;
          const [flatCheck, worldCheck] = check === undefined ? [read, inWorld] : [finite(check(flatSpace)), finite(check(worldSpace))];
          if (flatCheck !== null && worldCheck !== null && inWorld !== null) off = Math.abs(flatCheck - worldCheck);
          const limit = measure.unit === "degrees" ? limits.angle : limits.length;
          if (shown >= limits.shown && off !== null && off <= limit) onPicture = read;
        }
      }
      readings.set(m.name, { flat: onPicture, world: inWorld, shown, off });
    }
    return { t, leg, trunk, onFloor: flatSpace !== null && this.flatFloor.settled, readings };
  }

  /** The body's own leg and trunk, metres: the middle of every reading of them in the last `ownMemory`, each side seen in
   *  a frame one reading, the leg only while its knee is within `straightKnee` of straight (until it has been seen so,
   *  every reading of it). They do not change while the body is followed, so they never follow the last few seconds:
   *  side on, the far leg is seen now and then, and short, at the bottom of a squat. */
  private own(t: number, world: readonly (Vec | null)[]): { leg: number | null; trunk: number | null } {
    const limits = this.limits;
    const memories = [this.straightLegs, this.anyLegs, this.trunks];
    const newest = Math.max(...memories.map((m) => m.newest() ?? Number.NEGATIVE_INFINITY));
    if (t - newest > limits.lengthMemory) for (const m of memories) m.clear();
    for (const m of memories) m.forget(t - limits.ownMemory);
    for (const s of SIDES) {
      const hip = world[s.hip] ?? null;
      const knee = world[s.knee] ?? null;
      const ankle = world[s.ankle] ?? null;
      const shoulder = world[s.shoulder] ?? null;
      if (hip !== null && knee !== null && ankle !== null) {
        const leg = size(minus(hip, knee)) + size(minus(ankle, knee));
        this.anyLegs.add(t, leg);
        const angle = between(minus(hip, knee), minus(ankle, knee));
        if (angle !== null && angle >= 180 - limits.straightKnee) this.straightLegs.add(t, leg);
      }
      if (hip !== null && shoulder !== null) this.trunks.add(t, size(minus(shoulder, hip)));
    }
    return { leg: this.straightLegs.median() ?? this.anyLegs.median(), trunk: this.trunks.median() };
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
