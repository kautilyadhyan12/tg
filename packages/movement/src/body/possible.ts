// Is this body possible? (spec Part 2 §12.2, stage 2.) For one person, frame by frame, each
// of the 33 points is either used or refused with its reason, and a refused point decides
// nothing later: no count, no word of advice.
//
// Every check compares the body with ITSELF, never with an average body, so a child, a very
// tall man, somebody whose legs are long for their trunk or somebody with one arm is judged by
// their own body:
//   - the model is sure of the point and it lies on the picture;
//   - each point hangs from a parent on the way to the trunk (shoulder, elbow, wrist, fingers;
//     hip, knee, ankle, foot; the shoulders, nose, face) and is used only while the bone to its
//     parent keeps the length it has held, and the parent is used. So a wrong elbow takes its
//     wrist and hand with it, a wrong wrist never takes the elbow, and a hand, foot or head
//     moved in one piece cannot vouch for itself. A point whose parent is hidden cannot be
//     checked and decides nothing. The trunk's corners are checked by the trunk's own bones;
//   - a bone's own length is learned from the frames in which it held, and kept while the
//     person stays in view, so a wrong pose held for seconds stays refused. The allowance is a
//     share of the same body's trunk, not of the bone: on Kd's videos the model's error does not
//     grow with a bone's length (the bicycle crunch's short upper arms wander most, the squat's
//     long thighs least), so a person with long legs gets the same allowance as anybody of
//     their size;
//   - no point moves faster than any part of a person can (a kick's foot, the fastest,
//     is about 12 to 18 m/s);
//   - left and right have not swapped.
// A point that jumped is used again only once it has stayed at its new place for a moment,
// and every wait is a time, never a number of frames. Which person this is, is decided before
// (job 52d): this check follows whatever person it is given, and starts again with a person
// gone for longer than it remembers bones, or a clock that went back.
import type { Down, SeenPerson } from "@app/shared";
import { Memory } from "./memory.js";
import { BONES, LIMB_PAIRS, PARENT, POINTS, TRUNK, TRUNK_SIDES } from "./points.js";
import { bodySize } from "./size.js";

/** Why a point is not used. */
export type Refusal =
  /** the frame has the same time as the frame before it */
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
  /** what the point hangs from cannot be seen or is not used, so it cannot be checked */
  | "unchecked"
  /** the bone to its parent changed length, or its parent was refused for one */
  | "bone"
  /** the point moved faster than a body can, and has not stayed at its new place long enough */
  | "jump"
  /** left and right swapped, and the limb has not stayed so long enough */
  | "swap";

export interface Limits {
  /** Below this visibility or presence (the model's own 0 to 1) a point is not used. */
  readonly sure: number;
  /** A bone breaks when it differs from its own length by more than this share of the same
   *  body's trunk (shoulder to hip, in 3D). */
  readonly bone: number;
  /** How long a bone's held lengths and the trunk's are remembered, ms; a person gone longer is
   *  a new body. */
  readonly boneMemory: number;
  /** How long a bone, and the body, must have been seen before they are judged, ms. */
  readonly learn: number;
  /** Faster than this, metres a second across the picture, a point has jumped. */
  readonly speed: number;
  /** How long a point that jumped or swapped must stay at its new place before it is used, ms. */
  readonly settle: number;
  /** How long the body's size on the picture is remembered, ms. */
  readonly sizeMemory: number;
  /** Left and right are told apart only when their points lie at least this share of the
   *  trunk apart. */
  readonly swapApart: number;
}

/**
 * Where each number comes from. `sure`: the model's own sureness is a chance from 0 to 1, and
 * a point it gives less than an even chance of being seen is not used. `bone`: set by
 * `body-check` from Kd's reference videos, as the phone's own model reads them asked for one
 * person (51c), each limit set from all of them but one and tried on the one left out (`scripts/bodyCheck.ts`
 * says the rule; the videos that may set it are in `scripts/keptVideos.ts`). `speed`: the fastest a part of a person moves
 * is a kick's foot, measured at 12 to 18 m/s in martial arts studies (a punch's fist 6 to 11),
 * so nothing real is refused below 20; on the four of Kd's videos that set numbers no sure point moved
 * faster than 10. `settle`: at the slowest rate the engine takes, 8 frames a second, a fifth of a
 * second is two more looks at the new place. `swapApart`: a fifth of the trunk, about 10 cm for
 * a grown man, ten times the shake of a well-seen joint on Kd's videos (about 1 cm from one
 * frame to the next). The memories are the same for every body: 3 s holds a rep's worth of the
 * model's own wobble and was measured against 2 s and 5 s; half a second of learning; one
 * second of size.
 */
export const LIMITS: Limits = {
  sure: 0.5,
  bone: 0.3,
  boneMemory: 3000,
  learn: 500,
  speed: 20,
  settle: 200,
  sizeMemory: 1000,
  swapApart: 0.2,
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

type BoneState = "unjudged" | "learning" | "holds" | "broken";

/** One bone's own length. Learned over its first `learn` ms of being seen; after that a length
 *  joins it only when it held. A new length can still become the bone's own, since lengths alone
 *  cannot say which of two steady lengths is true, but only by being seen steady for as long as
 *  the old one had been seen holding: at least `learn`, at most `boneMemory`. So a wrong first
 *  look, contradicted at once, is soon replaced by the true length, and a length seen holding for
 *  seconds needs seconds. Only time the bone is seen counts: each look is worth its own frame's
 *  time, so the same seeing counts the same at any frame rate; a gap of more than `settle` adds
 *  nothing more, and drops a new length altogether, so a few lone looks never add up. */
class BoneLength {
  private held = new Memory();
  /** A run of broken lengths that agree with each other: a length that may be the bone's own. */
  private rival = new Memory();
  private known: number | null = null;
  /** When the bone was last judged. */
  private lastSeen: number | null = null;
  /** How long, in time seen: learning; the length known holding (learning included); the rival. */
  private learnedFor = 0;
  private heldFor = 0;
  private rivalFor = 0;

  /** `frame`: the time since the frame before, seen or not. */
  judge(t: number, now: number, allowance: number | null, limits: Limits, frame: number): BoneState {
    this.held.forget(t - limits.boneMemory);
    const gap = this.lastSeen === null ? Number.POSITIVE_INFINITY : t - this.lastSeen;
    this.lastSeen = t;
    const step = Math.min(limits.settle, gap <= limits.settle ? gap : frame);
    if (this.known === null) {
      this.learnedFor += step;
      if (allowance === null || this.learnedFor < limits.learn) {
        this.held.add(t, now);
        return "learning";
      }
      this.known = this.held.median() ?? now;
      this.heldFor = this.learnedFor;
    }
    if (allowance === null) return "learning";
    const own = this.held.median() ?? this.known;
    if (Math.abs(now - own) <= allowance) {
      this.held.add(t, now);
      this.known = own;
      this.heldFor += step;
      this.rival = new Memory();
      this.rivalFor = 0;
      return "holds";
    }
    const rivalLength = this.rival.median();
    if (rivalLength === null || gap > limits.settle || Math.abs(now - rivalLength) > allowance) {
      this.rival = new Memory();
      this.rivalFor = 0;
    } else {
      this.rivalFor += step;
    }
    this.rival.add(t, now);
    if (this.rivalFor < Math.min(limits.boneMemory, Math.max(limits.learn, this.heldFor))) return "broken";
    // The new length has been seen as long as the old one held: it is the bone's own now.
    this.held = this.rival;
    this.known = this.held.median() ?? now;
    this.heldFor = this.rivalFor;
    this.rival = new Memory();
    this.rivalFor = 0;
    return "holds";
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

/** For each point, the bone to its parent (its index in BONES), or -1. */
const PARENT_BONE: readonly number[] = PARENT.map((parent, child) =>
  BONES.findIndex(([a, b]) => (a === parent && b === child) || (a === child && b === parent)),
);
/** For each point that hangs from nothing, the bones that check it: a trunk corner, the trunk's
 *  bones to the other corners (any one that holds will do: a wrong hip must not take the
 *  shoulders with it); the nose, its bones to the shoulders (every shoulder seen and used must
 *  hold: the head hangs from both). Empty for the others. */
const ROOT_BONES: readonly (readonly number[])[] = Array.from({ length: POINTS }, (_, i) =>
  (PARENT[i] ?? -1) >= 0 ? [] : BONES.flatMap(([a, b], n) => ((a === i && TRUNK.includes(b)) || (b === i && TRUNK.includes(a)) ? [n] : [])),
);
/** Parents before their children, so a child can ask whether its parent was refused; the
 *  shoulders before the nose, which hangs from them. */
const CHECK_ORDER: readonly number[] = (() => {
  const depth = (i: number): number => {
    const parent = PARENT[i] ?? -1;
    if (parent < 0) return TRUNK.includes(i) ? 0 : 1;
    return 1 + depth(parent);
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

/** Everything the check remembers about one body. */
interface BodyState {
  readonly sizes: Memory;
  readonly trunk: Memory;
  readonly bones: BoneLength[];
  readonly points: PointState[];
  /** When the person was last found. */
  seen: number | null;
}

function freshBody(): BodyState {
  return {
    sizes: new Memory(),
    trunk: new Memory(),
    bones: BONES.map(() => new BoneLength()),
    points: Array.from({ length: POINTS }, () => ({ anchor: null, candidate: null })),
    seen: null,
  };
}

export class PossibleBody {
  private readonly limits: Limits;
  private lastT: number | null = null;
  private body: BodyState = freshBody();

  constructor(limits: Limits = LIMITS) {
    this.limits = limits;
  }

  /** One frame of the person followed, or null when nobody was found. */
  check(t: number, aspect: number, down: Down | null, person: SeenPerson | null): CheckedBody {
    const all = (why: Refusal): Refusal[] => new Array<Refusal>(POINTS).fill(why);
    if (this.lastT !== null && t === this.lastT) return { t, aspect, down, person, size: null, refused: all("time") };
    const { limits } = this;
    const frame = this.lastT !== null && t > this.lastT ? t - this.lastT : 0;
    // A clock that went back, or a person gone longer than bones are remembered: a new body.
    if ((this.lastT !== null && t < this.lastT) || (person !== null && this.body.seen !== null && t - this.body.seen > limits.boneMemory)) {
      this.body = freshBody();
    }
    this.lastT = t;
    const body = this.body;
    body.sizes.forget(t - limits.sizeMemory);
    body.trunk.forget(t - limits.boneMemory);

    if (person === null) return { t, aspect, down, person, size: body.sizes.median(), refused: all("not-found") };
    body.seen = t;
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
    if (fitted !== null) body.sizes.add(t, fitted);
    const size = body.sizes.median();
    const sides = TRUNK_SIDES.map(([a, b]) => length3d(world, a, b));
    const trunkNow = ((sides[0] ?? Number.NaN) + (sides[1] ?? Number.NaN)) / 2;
    if (Number.isFinite(trunkNow) && trunkNow > 0) body.trunk.add(t, trunkNow);
    const unit = body.trunk.span(t) >= limits.learn ? body.trunk.median() : null;

    // 3. Bones keep their own length.
    const bones: BoneState[] = BONES.map(() => "unjudged");
    BONES.forEach(([a, b], n) => {
      const length = body.bones[n];
      if (length === undefined || !sure[a] || !sure[b]) return;
      const now = length3d(world, a, b);
      if (Number.isFinite(now)) bones[n] = length.judge(t, now, unit === null ? null : limits.bone * unit, limits, frame);
    });
    const boneWhy = (i: number): "bone" | "settling" | "unchecked" | null => {
      const parent = PARENT[i] ?? -1;
      if (parent < 0 && TRUNK.includes(i)) {
        const own = (ROOT_BONES[i] ?? []).map((n) => bones[n] ?? "unjudged");
        if (own.includes("holds")) return null;
        if (own.includes("learning")) return "settling";
        return own.includes("broken") ? "bone" : "unchecked";
      }
      if (parent < 0) {
        // The nose: every bone to a shoulder that is used must hold, and there must be one.
        const ties = (ROOT_BONES[i] ?? []).flatMap((n) => {
          const [a, b] = BONES[n] ?? [i, i];
          return refused[a === i ? b : a] === null ? [bones[n] ?? "unjudged"] : [];
        });
        if (ties.includes("broken")) return "bone";
        if (ties.includes("learning")) return "settling";
        return ties.includes("holds") ? null : "unchecked";
      }
      const viaParent = bones[PARENT_BONE[i] ?? -1] ?? "unjudged";
      if (viaParent === "broken") return "bone";
      if (viaParent === "learning") return "settling";
      if (viaParent === "unjudged") return "unchecked";
      const parentWhy = refused[parent] ?? null;
      if (parentWhy === null) return null;
      return parentWhy === "bone" || parentWhy === "settling" ? parentWhy : "unchecked";
    };

    // 4. Left and right have not swapped.
    const place = (i: number): Place => ({ x: (person.points[i]?.[0] ?? 0) * aspect, y: person.points[i]?.[1] ?? 0, t });
    const swapped = new Set<number>();
    if (size !== null && unit !== null) {
      for (const pair of LIMB_PAIRS) {
        if (this.limbSwapped(pair, sure, place, size, unit)) for (const i of [...pair.left, ...pair.right]) swapped.add(i);
      }
    }

    // 5. Each sure point, parents first: settling, jumped or swapped, its bones, or used.
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
      const state = body.points[i];
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
    const state = this.body.points[i];
    if (state === undefined) return null;
    const { speed, settle } = this.limits;
    const before = state.candidate;
    // Back where it was last used, nearer there than where it went, and moving as a body can: the
    // throw was the model's, and the point is used again at once (52a-ii: the bicycle crunch's
    // legs, thrown onto each other for one frame, are true again the next).
    const anchor = state.anchor;
    if (before !== null && anchor !== null && !swappedNow && apart(here, anchor) < apart(here, before) && this.speed(anchor, here, size) <= speed) {
      state.candidate = null;
      return null;
    }
    // Still where it jumped to: it is used once it has stayed there long enough. This comes
    // before the plain move, since from where it was last used a jump looks slower with every
    // frame that passes.
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
   *  left was: each side lies nearer the other's last place than its own, and the two together
   *  are explained at least twice as well by a swap as by staying. Together, not each: the
   *  model may throw one limb onto the other and the other only half way (the bicycle crunch at
   *  0.57 s: the left knee onto the right's place, the right knee 0.65 of its own distance from
   *  the left's). One limb moved while the other stays is never a swap: the one that stays is
   *  the limbs' whole distance from the other's last place. Only places used within `settle`
   *  count: over a longer time two limbs that really cross, as in a bicycle crunch, can each end
   *  where the other was. */
  private limbSwapped(
    pair: (typeof LIMB_PAIRS)[number],
    sure: readonly boolean[],
    place: (i: number) => Place,
    size: number,
    unit: number,
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
      const leftWas = this.body.points[l]?.anchor ?? null;
      const rightWas = this.body.points[r]?.anchor ?? null;
      if (leftWas === null || rightWas === null) return;
      const left = place(l);
      if (left.t - leftWas.t > this.limits.settle || left.t - rightWas.t > this.limits.settle) return;
      const right = place(r);
      keepLeft += apart(left, leftWas);
      swapLeft += apart(left, rightWas);
      keepRight += apart(right, rightWas);
      swapRight += apart(right, leftWas);
      between += apart(leftWas, rightWas);
      count++;
    });
    if (count === 0 || between / count / size <= this.limits.swapApart * unit) return false;
    return swapLeft < keepLeft && swapRight < keepRight && swapLeft + swapRight < (keepLeft + keepRight) / 2;
  }
}
