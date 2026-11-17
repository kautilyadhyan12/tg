// Is this body possible? (spec Part 2 §12.2, stage 2.) For one person, frame by frame, each
// of the 33 points is either used or refused with its reason, and a refused point decides
// nothing later: no count, no word of advice.
//
// Every check compares the body with ITSELF a moment before, never with an average body, so
// a child, a very tall man, somebody whose legs are long for their trunk or somebody with one
// arm is judged by their own body:
//   - the model is sure of the point and it lies on the picture;
//   - each point's bone towards the trunk keeps the length it has had over the last seconds
//     (in 3D), and the point it hangs from is used: a wrong elbow takes its wrist and hand with
//     it, a wrong wrist never takes the elbow. The trunk's corners and the nose, which hang from
//     nothing, are checked by their own bones, and so is a point whose parent is hidden. The
//     allowance is a
//     share of the same body's trunk, not of the bone: on Kd's videos the model's error does not
//     grow with a bone's length (the bicycle crunch's short upper arms wander most, the squat's
//     long thighs least), so a person with long legs gets the same allowance as anybody of
//     their size;
//   - no point moves faster than any part of a person can (a kick's foot, the fastest,
//     is about 12 to 18 m/s);
//   - left and right have not swapped.
// A point that jumped is used again only once it has stayed at its new place for a moment,
// and every wait is a time, never a number of frames. Which person this is, is decided before
// (job 52d): this check follows whatever person it is given.
import type { Down, SeenPerson } from "@app/shared";
import { BONES, LIMB_PAIRS, PARENT, POINTS, TRUNK_SIDES } from "./points.js";
import { bodySize } from "./size.js";

/** Why a point is not used. */
export type Refusal =
  /** the frame's time is not after the frame before it */
  | "time"
  /** nobody was found in this frame */
  | "not-found"
  /** the pose model gave no 3D points, so the body cannot be checked */
  | "no-3d"
  /** the model is not sure it can see the point */
  | "hidden"
  /** the point is off the picture */
  | "outside"
  /** the body is still being learned: its bones and size are not known yet */
  | "settling"
  /** a bone through the point changed length */
  | "bone"
  /** the point moved faster than a body can, and has not stayed at its new place long enough */
  | "jump"
  /** left and right swapped, and the limb has not stayed so long enough */
  | "swap";

export interface Limits {
  /** Below this visibility or presence (the model's own 0 to 1) a point is not used. */
  readonly sure: number;
  /** A bone breaks when it differs from its own recent length by more than this share of the
   *  same body's trunk (shoulder to hip, in 3D). */
  readonly bone: number;
  /** How long a bone's lengths and the trunk's are remembered, ms. */
  readonly boneMemory: number;
  /** How long a bone, and the body, must have been seen before they are judged, ms. */
  readonly learn: number;
  /** Faster than this, metres a second across the picture, a point has jumped. */
  readonly speed: number;
  /** How long a point that jumped or swapped must stay at its new place before it is used, ms. */
  readonly settle: number;
  /** How long the body's size on the picture is remembered, ms. */
  readonly sizeMemory: number;
  /** Left and right are told apart only when their points lie at least this far apart, metres. */
  readonly swapApart: number;
}

/**
 * Where each number comes from. `sure`: the model's own sureness is a chance from 0 to 1, and
 * a point it gives less than an even chance of being seen is not used. `bone`: set by
 * `body-check` from Kd's six reference videos, each limit set from five people and tried on the
 * sixth (`scripts/bodyCheck.ts` says the rule). `speed`: the fastest a part of a person moves
 * is a kick's foot, measured at 12 to 18 m/s in martial arts studies (a punch's fist 6 to 11),
 * so nothing real is refused below 20; on Kd's four one-person videos no sure point moved faster
 * than 10. `settle`: at the slowest rate the engine takes, 8 frames a second, a fifth of a
 * second is two more looks at the new place. `swapApart`: ten times the shake of a well-seen
 * joint on Kd's videos (about 1 cm from one frame to the next). The memories are the same for
 * every body: 3 s holds a rep's worth of the model's own wobble and was measured against 2 s
 * and 5 s; half a second of learning; one second of size.
 */
export const LIMITS: Limits = {
  sure: 0.5,
  bone: 0.25,
  boneMemory: 3000,
  learn: 500,
  speed: 20,
  settle: 200,
  sizeMemory: 1000,
  swapApart: 0.1,
};

/** One frame of one person after the check. */
export interface CheckedBody {
  readonly t: number;
  readonly aspect: number;
  readonly down: Down | null;
  /** The person as the model gave them, or null when nobody was found. */
  readonly person: SeenPerson | null;
  /** Picture heights for each metre of this body over the last moment; null while unknown. */
  readonly size: number | null;
  /** For each of the 33 points: null when it may be used, otherwise why not. */
  readonly refused: readonly (Refusal | null)[];
}

interface Timed {
  readonly t: number;
  readonly v: number;
}

/** Numbers remembered for a while: a bone's length, the body's size. */
class Memory {
  private items: Timed[] = [];

  add(t: number, v: number): void {
    this.items.push({ t, v });
  }
  /** Forgets what is older than `before`. */
  forget(before: number): void {
    let drop = 0;
    while (drop < this.items.length && (this.items[drop]?.t ?? before) < before) drop++;
    if (drop > 0) this.items = this.items.slice(drop);
  }
  /** How long ago the oldest number remembered was seen. */
  span(t: number): number {
    const first = this.items[0];
    return first === undefined ? 0 : t - first.t;
  }
  median(): number | null {
    if (this.items.length === 0) return null;
    const sorted = this.items.map((x) => x.v).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const hi = sorted[mid] ?? 0;
    return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2;
  }
}

/** A point's place on the picture, in picture heights (so x is in true proportion), and when. */
interface Place {
  readonly x: number;
  readonly y: number;
  readonly t: number;
}
interface Candidate extends Place {
  readonly since: number;
  readonly why: "jump" | "swap";
}
interface PointState {
  /** Where it last was when it was used. */
  anchor: Place | null;
  /** Where it went after a jump or a swap, and since when it has stayed there. */
  candidate: Candidate | null;
}

type BoneState = "unjudged" | "learning" | "holds" | "broken";

/** For each point, the bone to its parent (its index in BONES), or -1. */
const PARENT_BONE: readonly number[] = PARENT.map((parent, child) =>
  BONES.findIndex(([a, b]) => (a === parent && b === child) || (a === child && b === parent)),
);
/** For each point, the bones that check it when it has no parent or its parent cannot be seen.
 *  A point that hangs from a parent: every other bone through it. One that hangs from nothing:
 *  every bone through it but those to its own children (a wrong elbow says nothing about the
 *  shoulder), or all of them if that leaves none, as for the nose. */
const OWN_BONES: readonly (readonly number[])[] = Array.from({ length: POINTS }, (_, i) => {
  const through = BONES.flatMap(([a, b], n) => (a === i || b === i ? [n] : []));
  if ((PARENT[i] ?? -1) >= 0) return through.filter((n) => n !== PARENT_BONE[i]);
  const notToChildren = through.filter((n) => {
    const [a, b] = BONES[n] ?? [i, i];
    return PARENT[a === i ? b : a] !== i;
  });
  return notToChildren.length > 0 ? notToChildren : through;
});
/** Parents before their children, so a child can ask whether its parent was refused. */
const CHECK_ORDER: readonly number[] = (() => {
  const depth = (i: number): number => {
    const parent = PARENT[i] ?? -1;
    return parent < 0 ? 0 : 1 + depth(parent);
  };
  return Array.from({ length: POINTS }, (_, i) => i).sort((a, b) => depth(a) - depth(b) || a - b);
})();

function apart(a: Place, b: Place): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function length3d(world: readonly (readonly number[])[], a: number, b: number): number {
  const p = world[a];
  const q = world[b];
  if (p === undefined || q === undefined) return Number.NaN;
  return Math.hypot((p[0] ?? 0) - (q[0] ?? 0), (p[1] ?? 0) - (q[1] ?? 0), (p[2] ?? 0) - (q[2] ?? 0));
}

export class PossibleBody {
  private readonly limits: Limits;
  private lastT: number | null = null;
  private readonly sizes = new Memory();
  private readonly trunk = new Memory();
  private readonly bones: Memory[] = BONES.map(() => new Memory());
  private readonly points: PointState[] = Array.from({ length: POINTS }, () => ({ anchor: null, candidate: null }));

  constructor(limits: Limits = LIMITS) {
    this.limits = limits;
  }

  /** One frame of the person followed, or null when nobody was found. */
  check(t: number, aspect: number, down: Down | null, person: SeenPerson | null): CheckedBody {
    const all = (why: Refusal): Refusal[] => new Array<Refusal>(POINTS).fill(why);
    if (this.lastT !== null && !(t > this.lastT)) {
      return { t, aspect, down, person, size: null, refused: all("time") };
    }
    this.lastT = t;
    const { limits } = this;
    this.sizes.forget(t - limits.sizeMemory);
    this.trunk.forget(t - limits.boneMemory);
    for (const memory of this.bones) memory.forget(t - limits.boneMemory);

    if (person === null) return { t, aspect, down, person, size: this.sizes.median(), refused: all("not-found") };
    const world = person.world;
    if (world === null) return { t, aspect, down, person, size: null, refused: all("no-3d") };

    // 1. The model is sure of it, and it lies on the picture.
    const refused: (Refusal | null)[] = new Array<Refusal | null>(POINTS).fill(null);
    const sure: boolean[] = new Array<boolean>(POINTS).fill(false);
    for (let i = 0; i < POINTS; i++) {
      const [x = -1, y = -1, , visibility = 0, presence = 0] = person.points[i] ?? [];
      if (visibility < limits.sure) refused[i] = "hidden";
      else if (presence < limits.sure || x < 0 || x > 1 || y < 0 || y > 1) refused[i] = "outside";
      else sure[i] = true;
    }

    // 2. The body's size on the picture, and its own unit of length: its trunk.
    const fitted = bodySize(person, aspect, sure);
    if (fitted !== null) this.sizes.add(t, fitted);
    const size = this.sizes.median();
    const sides = TRUNK_SIDES.map(([a, b]) => length3d(world, a, b));
    const trunkNow = ((sides[0] ?? Number.NaN) + (sides[1] ?? Number.NaN)) / 2;
    if (Number.isFinite(trunkNow) && trunkNow > 0) this.trunk.add(t, trunkNow);
    const unit = this.trunk.span(t) >= limits.learn ? this.trunk.median() : null;

    // 3. Bones keep their length.
    const bones: BoneState[] = BONES.map(() => "unjudged");
    BONES.forEach(([a, b], n) => {
      const memory = this.bones[n];
      if (memory === undefined || !sure[a] || !sure[b]) return;
      const now = length3d(world, a, b);
      if (!Number.isFinite(now)) return;
      const own = memory.span(t) >= limits.learn ? memory.median() : null;
      bones[n] = own === null || unit === null ? "learning" : Math.abs(now - own) > limits.bone * unit ? "broken" : "holds";
      memory.add(t, now);
    });
    const boneWhy = (i: number): "bone" | "settling" | null => {
      const parent = PARENT[i] ?? -1;
      const viaParent = bones[PARENT_BONE[i] ?? -1] ?? "unjudged";
      if (viaParent === "broken") return "bone";
      if (viaParent === "learning") return "settling";
      if (viaParent === "holds") return refused[parent] === "bone" ? "bone" : null;
      const own = (OWN_BONES[i] ?? []).map((n) => bones[n] ?? "unjudged");
      const holding = own.includes("holds");
      if (!holding && own.includes("learning")) return "settling";
      return !holding && own.includes("broken") ? "bone" : null;
    };

    // 4. Left and right have not swapped.
    const place = (i: number): Place => ({ x: (person.points[i]?.[0] ?? 0) * aspect, y: person.points[i]?.[1] ?? 0, t });
    const swapped = new Set<number>();
    if (size !== null) {
      for (const pair of LIMB_PAIRS) {
        if (this.limbSwapped(pair, sure, place, size)) for (const i of [...pair.left, ...pair.right]) swapped.add(i);
      }
    }

    // 5. Each sure point, parents first: settling, jumped or swapped, a broken bone, or used.
    for (const i of CHECK_ORDER) {
      if (!sure[i]) continue;
      if (unit === null || size === null) {
        refused[i] = "settling";
        continue;
      }
      const here = place(i);
      const moved = this.jumped(i, here, swapped.has(i), size);
      const why: Refusal | null = moved ?? boneWhy(i);
      refused[i] = why;
      const state = this.points[i];
      if (why === null && state !== undefined) {
        state.anchor = here;
        state.candidate = null;
      }
    }
    return { t, aspect, down, person, size, refused };
  }

  /** Metres a second from one place to another, for this body's size. */
  private speed(from: Place, to: Place, size: number): number {
    return apart(from, to) / size / ((to.t - from.t) / 1000);
  }

  /** "jump" or "swap" while the point is away from where it was last used and has not yet
   *  stayed at its new place for `settle`; null otherwise. */
  private jumped(i: number, here: Place, swappedNow: boolean, size: number): "jump" | "swap" | null {
    const state = this.points[i];
    if (state === undefined) return null;
    const { speed, settle } = this.limits;
    // Still where it jumped to: it is used once it has stayed there long enough. This comes
    // first, since from where it was last used a jump looks slower with every frame that passes.
    const before = state.candidate;
    if (before !== null && this.speed(before, here, size) <= speed) {
      state.candidate = { ...here, since: before.since, why: before.why };
      return here.t - before.since >= settle ? null : before.why;
    }
    // Back where it was, or moving as a body can.
    if (!swappedNow && (state.anchor === null || this.speed(state.anchor, here, size) <= speed)) {
      state.candidate = null;
      return null;
    }
    state.candidate = { ...here, since: here.t, why: swappedNow ? "swap" : "jump" };
    return state.candidate.why;
  }

  /** True when the left limb now lies where the right one last was and the right where the
   *  left was: each side is explained at least twice as well by a swap as by staying. */
  private limbSwapped(
    pair: (typeof LIMB_PAIRS)[number],
    sure: readonly boolean[],
    place: (i: number) => Place,
    size: number,
  ): boolean {
    let keepLeft = 0;
    let swapLeft = 0;
    let keepRight = 0;
    let swapRight = 0;
    let between = 0;
    let count = 0;
    pair.left.forEach((l, k) => {
      const r = pair.right[k];
      if (r === undefined || !sure[l] || !sure[r]) return;
      const leftWas = this.points[l]?.anchor ?? null;
      const rightWas = this.points[r]?.anchor ?? null;
      if (leftWas === null || rightWas === null) return;
      const left = place(l);
      const right = place(r);
      keepLeft += apart(left, leftWas);
      swapLeft += apart(left, rightWas);
      keepRight += apart(right, rightWas);
      swapRight += apart(right, leftWas);
      between += apart(leftWas, rightWas);
      count++;
    });
    if (count === 0 || between / count / size <= this.limits.swapApart) return false;
    return swapLeft < keepLeft / 2 && swapRight < keepRight / 2;
  }
}
