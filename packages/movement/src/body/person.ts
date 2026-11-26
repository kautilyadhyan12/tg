// One person locked on (spec Part 2 §12.2, stage 1; §11.8; ROADMAP 52d-i). Asked for one person the pose model gives one
// body in every picture, whoever it is: a passer-by walking in front, a neighbour, a reflection. This stage says, picture
// by picture, which body is the set's person, and gives every other body to nothing after it: no count, no word, no time
// held. The count waits until the person is back, and goes on from where it was.
//
// Two parts of a set, in the order a person lives them:
//   - **Before the set has counted** (no rep counted, no second held), the person is the body the model follows, through
//     a walk back from the phone to their place or to a machine: a body that came bit by bit from their newest look (the
//     plain sign of 51c finds no change: its middle no faster than a jump's take-off, its size not jumping), or one at
//     their place and size, is them. A body found after a picture with nobody that is none of these is a new person, and
//     every stage after this one starts afresh with it, so it never borrows the body before's bones, leg or floor: on
//     Kd's own videos the sign fires on him so, walking back from the phone unseen for a moment and found again 1.3 to
//     1.8 times smaller. A body that came all at once with no picture of nobody between (a passer-by walking in front)
//     is withheld while the person may come back, and the person then goes on as they were; followed for as long as
//     bones are remembered while the person is not seen, it is the set's person instead, afresh.
//   - **Once the set has counted** (`confirm`), the person is a body that goes on, picture by picture, from their newest
//     look a moment before (`walks`: the plain sign finding no change, never more than a lost picture between), wherever
//     it walks (a step to another place in the middle of a set, 52d-ii); or a body at one of their two places, at their
//     size there: where they exercised in the second before the set counted, which stays theirs for the set, and where
//     they were over their last second followed, which goes with them (within `room` of the place and `sizeRoom` of the
//     size). Any other body, anywhere else or nearer or further from the phone, counts nothing, however long it stays, and
//     a body whose size cannot be read decides nothing. A body that came all at once from outside that place (the model
//     changing bodies: a neighbour, a passer-by) stays another while it goes on bit by bit from there, into the place too,
//     across pictures with nobody or whose size cannot be read, until it has stood in the place for `takeOver` (two
//     bodies there at one size cannot be told apart, and one that stays there is the person far more often than one
//     crossing it) or has not been seen for as long. Every other body seen outside the places is held so, the person found
//     away from them after the camera lost them too, who back in a place waits as long; and so is every other body in a
//     picture the person is given in, its time in a place counted only once the person has gone. A body found in a place
//     after a moment of nobody is the person at once unless it lies within the held body's reach, a jump's speed over at
//     most one picture at 8 a second (about 1 m). Where they were over their last second is theirs only for `takeOver`
//     after their newest look. A body the camera did not see go on from the person, picture by picture, never takes their
//     place anywhere else. Nothing in this is any exercise's own: every movement gets it, with the same numbers.
//
// What it uses, measured on the proof videos (lock-check): where the trunk's middle lies on the picture and how large the
// body is (`bodySize`, picture heights for each metre of body). Not the body's own proportions: in 3D the model reads one
// man's thigh 0.75 to 0.98 of his trunk across his own sets and every proof set's 0.73 to 0.90, so they cannot tell two
// people apart. So what it cannot do: a body of the person's size whose trunk lies within `room` of their place when the
// model changes to it (a neighbour less than about a stride away), or that stays there for `takeOver`, is taken for them,
// and followed wherever it then walks.
import { KP, type Down, type MovementFrame, type SeenPerson } from "@app/shared";
import { LIMITS } from "./possible.js";
import { TRUNK } from "./points.js";
import { bodySize } from "./size.js";

export interface PersonLimits {
  /** Faster than this, metres a second across the picture, the trunk's middle has not moved: another body was taken. */
  readonly speed: number;
  /** Straight up or down the picture (under `straight` across "down"), another body only faster than this, m/s. */
  readonly jumpSpeed: number;
  /** Across "down", m/s: under this the trunk moved straight up or down. */
  readonly straight: number;
  /** A body larger or smaller on the picture than this many times than the one followed a moment before is another. */
  readonly changedSize: number;
  /** Before the set has counted: a withheld body followed this long, ms, while the person is not seen, is the set's
   *  person instead. Once it has counted: a body held as another stops being held after standing in the person's place
   *  this long, or after not being seen this long. */
  readonly takeOver: number;
  /** Once the set has counted: the person's place and size are the middle of where they were over this last, ms. */
  readonly place: number;
  /** The longest step between two pictures the engine takes, ms: a body held as another reaches no further than a jump's
   *  speed over this, however long it was unseen. */
  readonly pictureStep: number;
  /** Once the set has counted: a person walking away from their place is followed with no more than this between two
   *  of their looks, ms; after a longer gap they are the person again only in their place. */
  readonly walkGap: number;
  /** Once the set has counted: further than this from the person's place, metres at their size, a body is another. */
  readonly room: number;
  /** Once the set has counted: larger or smaller than this many times the person's size, a body is another. */
  readonly sizeRoom: number;
}

/**
 * Where each number comes from. The plain sign of a changed body (51c, `scripts/follow.ts`): the fastest a person moves
 * their trunk is a jump's take-off, for a jump of 1.1 m √(2 · 9.81 · 1.1) = 4.6 m/s, so 5; straight up or down a jump's
 * take-off or landing reached 5.1 to 7.1 m/s on Kd's four squat-jump videos (52c-i), so 8 under 1 m/s across; on Kd's
 * six reference videos the size changed at most 1.12 times from one picture to the next, so 1.25. `pictureStep`: a picture
 * at the slowest rate the engine takes, 8 a second (the matcher's `SLOWEST_RATE`; the phone's slowest second, 51b-ii); `walkGap`, two
 * such steps: one picture lost while a person walks (a phone loses a walking body for a picture). `takeOver`: the
 * possible-body check's memory of bones (`LIMITS.boneMemory`): a person gone longer is a new body to it. `place`, `room`
 * and `sizeRoom` are set by `lock-check` from every proof set the camera counts or times, as filmed and under each replay that must hold: from
 * the moment the set first counted to the last rep or second it reported, how far the trunk's middle went from the
 * place of the second before, and how much larger or smaller the body read, each bound beyond the furthest set by half
 * its distance from the middle set (`scripts/lockCheck.ts` says the rule).
 */
export const PERSON_LIMITS: PersonLimits = {
  speed: 5,
  jumpSpeed: 8,
  straight: 1,
  changedSize: 1.25,
  takeOver: LIMITS.boneMemory,
  place: 1000,
  pictureStep: 125,
  walkGap: 250,
  room: 0.95,
  sizeRoom: 1.35,
};

/** Who the body given this picture is. "person": the set's person (`person` holds them); "other": every body the model
 *  found is somebody else; "unsure": a body was found whose size cannot be read, so it decides nothing; "nobody": the
 *  model found nobody. */
export type PersonStatus = "person" | "other" | "unsure" | "nobody";

export interface PersonFrame {
  readonly t: number;
  /** The set's person in this picture, or null: every stage after this one then reads nobody. */
  readonly person: SeenPerson | null;
  readonly status: PersonStatus;
  /** A new person is learned from this picture on (before the set has counted): every stage after this one starts
   *  afresh, as at a clock that went back. */
  readonly fresh: boolean;
}

/** One look at a body: when, where its trunk's middle lies on the picture (picture heights from the top left, across
 *  in the picture's own proportions), and its size, picture heights for each metre of it. */
export interface Look {
  readonly t: number;
  readonly middle: readonly [number, number];
  readonly size: number;
}

/** The trunk's middle on the picture: the middle of both shoulders and both hips, picture heights. */
export function trunkMiddle(person: SeenPerson, aspect: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const i of TRUNK) {
    x += (person.points[i]?.[0] ?? 0) * aspect;
    y += person.points[i]?.[1] ?? 0;
  }
  return [x / TRUNK.length, y / TRUNK.length];
}

/** The joints a body's size is read from first: the trunk and the legs. The arms only where fewer than four of these are
 *  sure (filmed from the feet of a bench, the legs are off the picture): the model guesses the arms most often (the far
 *  arm, hidden behind the body) and they swing far from the trunk, and one arm guessed in a new place every picture, read
 *  too, made the size jump past the plain sign on Kd's reference videos (possibleBody.test.ts). */
export const SIZE_JOINTS: readonly number[] = [KP.left_shoulder, KP.right_shoulder, KP.left_hip, KP.right_hip, KP.left_knee, KP.right_knee, KP.left_ankle, KP.right_ankle];

/** A look at the body, or null when its size cannot be read (the points the model is sure of do not fix one). */
export function lookAt(person: SeenPerson, aspect: number, t: number, sure: number = LIMITS.sure): Look | null {
  const seen = person.points.map((p) => p[3] >= sure);
  const trunkAndLegs = seen.map((s, i) => s && SIZE_JOINTS.includes(i));
  const size = bodySize(person, aspect, trunkAndLegs.filter(Boolean).length >= 4 ? trunkAndLegs : seen);
  return size === null ? null : { t, middle: trunkMiddle(person, aspect), size };
}

export interface BodyChange {
  /** Metres a second the trunk's middle moved, at the larger of the two sizes, and how many times larger or smaller the
   *  body became. */
  readonly speed: number;
  readonly size: number;
  /** By the plain sign, another body. */
  readonly changed: boolean;
}

/** The plain sign that `now` is not the body of `before` (51c): its middle faster than a jump's take-off (straight up
 *  or down, faster than a jump's), or its size jumping. Across a gap the move is judged over the whole time between.
 *  Null when `now` is not later than `before`. */
export function bodyChange(before: Look, now: Look, down: Down | null, limits: PersonLimits = PERSON_LIMITS): BodyChange | null {
  if (!(now.t > before.t)) return null;
  const scale = Math.max(now.size, before.size) * ((now.t - before.t) / 1000);
  const dx = (now.middle[0] - before.middle[0]) / scale;
  const dy = (now.middle[1] - before.middle[1]) / scale;
  const speed = Math.hypot(dx, dy);
  // Along "down" as the picture shows it (a reference video's is straight down the picture), and across it.
  const shown = down === null ? 0 : Math.hypot(down[0], down[1]);
  const [ux, uy] = down === null || !(shown > 0) ? [0, 1] : [down[0] / shown, down[1] / shown];
  const along = dx * ux + dy * uy;
  const across = Math.sqrt(Math.max(0, speed * speed - along * along));
  const limit = across < limits.straight ? limits.jumpSpeed : limits.speed;
  const size = Math.max(now.size, before.size) / Math.min(now.size, before.size);
  return { speed, size, changed: speed > limit || size > limits.changedSize };
}

/** Metres from the person's place at their size, and how many times larger or smaller (always 1 or more). */
export function fromPlace(look: Look, place: { readonly middle: readonly [number, number]; readonly size: number }): { readonly metres: number; readonly size: number } {
  const metres = Math.hypot(look.middle[0] - place.middle[0], look.middle[1] - place.middle[1]) / place.size;
  const size = Math.max(look.size, place.size) / Math.min(look.size, place.size);
  return { metres, size };
}

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Once the set has counted, a body held as another (`OnePerson.holds`): its newest look, and since when it has stood in one of
 *  the person's places while the person was not given, or null. */
interface Hold {
  readonly look: Look;
  readonly inPlace: number | null;
}

/** Where looks lie: the middle of their trunks' middles, at the middle of their sizes. */
function placeOf(looks: readonly Look[]): { readonly middle: readonly [number, number]; readonly size: number } {
  return { middle: [median(looks.map((l) => l.middle[0])), median(looks.map((l) => l.middle[1]))], size: median(looks.map((l) => l.size)) };
}

interface Seen {
  readonly person: SeenPerson;
  readonly look: Look | null;
}

/** The body whose middle lies nearest `to`. */
function nearest(seen: readonly (Seen & { readonly look: Look })[], to: readonly [number, number]): Seen & { readonly look: Look } {
  let best = seen[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of seen) {
    const d = Math.hypot(s.look.middle[0] - to[0], s.look.middle[1] - to[1]);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best === undefined) throw new Error("nearest of no bodies");
  return best;
}

/** The largest body on the picture: the nearest the phone (§11.8). */
function largest(seen: readonly (Seen & { readonly look: Look })[]): Seen & { readonly look: Look } {
  let best = seen[0];
  for (const s of seen) if (best === undefined || s.look.size > best.look.size) best = s;
  if (best === undefined) throw new Error("largest of no bodies");
  return best;
}

export class OnePerson {
  private readonly limits: PersonLimits;
  private lastT: number | null = null;
  private lastFrame: PersonFrame | null = null;
  /** The person's newest look whose size was read; null before anybody was followed. */
  private person: Look | null = null;
  /** When the person was last given. */
  private seenAt: number | null = null;
  /** The person's looks over the last `place`, for `confirm`. */
  private recent: Look[] = [];
  /** Before the set has counted: a body withheld, followed by the plain sign since `since`. */
  private other: { readonly look: Look; readonly since: number } | null = null;
  /** Once the set has counted: every body held as another (`Hold`). */
  private holds: Hold[] = [];
  /** Where the person exercised and their size there, from the moment the set first counted: theirs for the set. */
  private placed: { readonly middle: readonly [number, number]; readonly size: number } | null = null;
  /** Once the set has counted, where the person has been over their last `place` followed and their size there: it goes
   *  with them (52d-ii). */
  private here: { readonly middle: readonly [number, number]; readonly size: number } | null = null;

  constructor(limits: PersonLimits = PERSON_LIMITS) {
    this.limits = limits;
  }

  /** Whether the set has counted, so that only a body at the person's place and size is the person. */
  get confirmed(): boolean {
    return this.placed !== null;
  }

  /** Where the person exercised and their size there, once the set has counted. */
  get place(): { readonly middle: readonly [number, number]; readonly size: number } | null {
    return this.placed;
  }

  /** Where the person has been over their last second followed, once the set has counted. */
  get where(): { readonly middle: readonly [number, number]; readonly size: number } | null {
    return this.here;
  }

  /** The set has counted (its first rep, or its first held second): from the next picture on the person is a body at the
   *  place and size they had over the last `place`, or at their newest look whose size was read when none was read then
   *  (a set that has counted never starts afresh: a new person would take its count). False only before anybody was
   *  followed. */
  confirm(): boolean {
    if (this.placed !== null) return true;
    const t = this.lastT;
    if (t === null) return false;
    const recent = this.recent.filter((l) => l.t > t - this.limits.place);
    const looks = recent.length > 0 ? recent : this.person === null ? [] : [this.person];
    if (looks.length === 0) return false;
    this.placed = placeOf(looks);
    this.here = this.placed;
    this.other = null;
    this.holds = [];
    return true;
  }

  next(frame: MovementFrame): PersonFrame {
    const { t } = frame;
    // A picture with the same time as the one before decides nothing new (every stage after refuses it whole).
    if (this.lastT !== null && t === this.lastT && this.lastFrame !== null) return { ...this.lastFrame, fresh: false };
    // A clock that went back is a new set.
    if (this.lastT !== null && t < this.lastT) this.restart();
    this.lastT = t;
    const out = this.decide(frame);
    this.lastFrame = out;
    return out;
  }

  private restart(): void {
    this.person = null;
    this.seenAt = null;
    this.other = null;
    this.holds = [];
    this.recent = [];
    this.placed = null;
    this.here = null;
    this.lastFrame = null;
  }

  /** Whether `now` goes on from `from` as a person walking does: the plain sign finds no change, with no more than
   *  `walkGap` between them, and it reaches no further than the plain sign's speed over one picture at the slowest rate
   *  (`pictureStep`), however long the gap. */
  private walks(from: Look, now: Look, down: Down | null): boolean {
    const ms = now.t - from.t;
    if (!(ms > 0) || ms > this.limits.walkGap) return false;
    const c = bodyChange(from, now, down, this.limits);
    return c !== null && !c.changed && c.speed * ms <= this.limits.speed * Math.min(ms, this.limits.pictureStep);
  }

  private given(person: SeenPerson, look: Look | null, t: number, fresh: boolean): PersonFrame {
    this.seenAt = t;
    this.other = null;
    if (look !== null) {
      this.person = look;
      this.recent = [...this.recent.filter((l) => l.t > t - this.limits.place), look];
      // Once the set has counted, where they are goes with them.
      if (this.placed !== null) this.here = placeOf(this.recent);
    }
    return { t, person, status: "person", fresh };
  }

  private decide(frame: MovementFrame): PersonFrame {
    const { t } = frame;
    const none = (status: PersonStatus): PersonFrame => ({ t, person: null, status, fresh: false });
    if (frame.people.length === 0) return none("nobody");
    const seen: Seen[] = frame.people.map((person) => ({ person, look: lookAt(person, frame.aspect, t) }));
    const readable = seen.filter((s): s is Seen & { readonly look: Look } => s.look !== null);

    // Once the set has counted: a body that goes on from the person, picture by picture, wherever it walks, or one at one
    // of their places and their size there; never one held as another; nobody else.
    const placed = this.placed;
    if (placed !== null) {
      // Where they were over their last second followed is theirs only for `takeOver` after their newest look (round one,
      // H2: never forgotten, the spot where a member walked out of the picture took anybody who came in there later).
      const person = this.person;
      const here = this.here !== null && person !== null && t - person.t < this.limits.takeOver ? this.here : null;
      const within = (x: Seen & { readonly look: Look }, at: { readonly middle: readonly [number, number]; readonly size: number }): boolean => {
        const d = fromPlace(x.look, at);
        return d.metres <= this.limits.room && d.size <= this.limits.sizeRoom;
      };
      const atPlace = (x: Seen & { readonly look: Look }): boolean => within(x, placed) || (here !== null && within(x, here));
      // Every body held as another: kept across pictures with nobody or whose size cannot be read (a phone loses a walking
      // body for a picture), ended once it has stood in a place for `takeOver` or has not been seen for as long.
      const active = this.holds.filter((h) => t - h.look.t <= this.limits.takeOver && (h.inPlace === null || t - h.inPlace < this.limits.takeOver));
      // Followed more loosely than the plain sign, a jump's speed in any direction: a body crossing the place while it jumps
      // moves across and up at once (a squat jumper walked across a member's place, 1.2 m/s across, broke the plain sign
      // and was taken), and a looser follow only keeps a body refused longer, which the 3 s in the place still ends. Its
      // reach is one picture's at most, however long the held body was unseen: judged over the whole time, it grew to 2.6 m
      // after a third of a second of nobody, and the person found again in their place after a passer-by went on from the
      // passer-by and was refused 3 s (round one's re-check, N1).
      const reaches = (h: Hold, x: Seen & { readonly look: Look }): boolean => {
        const c = bodyChange(h.look, x.look, frame.down, this.limits);
        if (c === null) return true;
        const seconds = (t - h.look.t) / 1000;
        return c.speed * seconds <= this.limits.jumpSpeed * Math.min(seconds, this.limits.pictureStep / 1000) && c.size <= this.limits.changedSize;
      };
      // Each hold goes on in the body nearest where it was, of those within its reach that no other hold has taken, the
      // newest hold first: with several bodies in a picture each is followed on its own, and one beside a held body is
      // not held with it (52d-ii's round one and its re-check, H2: one body held, a second beside where the member had
      // walked to was taken once they had gone).
      const pairs: { readonly hold: Hold; readonly body: Seen & { readonly look: Look } }[] = [];
      for (const h of [...active].sort((a, b) => b.look.t - a.look.t)) {
        const free = readable.filter((x) => !pairs.some((q) => q.body === x) && reaches(h, x));
        if (free.length > 0) pairs.push({ hold: h, body: nearest(free, h.look.middle) });
      }
      const held = pairs.map((q) => q.body);
      /** These bodies held from this picture on, each going on from its own hold or afresh, in a place since `inPlace`. */
      const holdAll = (bodies: readonly (Seen & { readonly look: Look })[], inPlace: (x: Seen & { readonly look: Look }, before: Hold | null) => number | null): Hold[] =>
        bodies.map((x) => ({ look: x.look, inPlace: inPlace(x, pairs.find((q) => q.body === x)?.hold ?? null) }));
      // The person given, every other body in the same picture is somebody else: each is held, its time in a place counted
      // only once the person has gone (round one, H2: a neighbour beside where the member walked to, seen with them, was
      // taken the moment the member left the picture).
      const give = (s: Seen & { readonly look: Look }): PersonFrame => {
        const out = this.given(s.person, s.look, t, false);
        this.holds = holdAll(readable.filter((x) => x !== s), () => null);
        return out;
      };
      // The person walking away from their place (52d-ii), or doing their reps there: a body that goes on from their newest
      // look a moment before, picture by picture (`walks`), the one going on first, as before the set has counted.
      const going = person === null ? [] : readable.filter((x) => !held.includes(x) && this.walks(person, x.look, frame.down));
      if (person !== null && going.length > 0) return give(nearest(going, person.middle));
      const there = readable.filter((x) => !held.includes(x) && atPlace(x));
      if (there.length > 0) return give(nearest(there, (here ?? placed).middle));
      if (readable.length === 0) return none("unsure");
      // Every body in the picture is another, the person found away from their places after losing them for longer than
      // `walkGap` included: each held, going on from its hold or from its first picture here, so that in a place it is the
      // person only after `takeOver` there (one found in a place after a moment of nobody is the person at once unless it
      // lies within a held body's reach); a hold not seen in this picture is kept.
      this.holds = [
        ...active.filter((h) => !pairs.some((q) => q.hold === h)),
        ...holdAll(readable, (x, before) => (atPlace(x) ? (before?.inPlace ?? t) : null)),
      ];
      return none("other");
    }

    // Nobody followed yet: the largest body, the nearest the phone (§11.8).
    const person = this.person;
    if (person === null) {
      if (readable.length === 0) return none("unsure");
      const s = largest(readable);
      return this.given(s.person, s.look, t, false);
    }

    // The person: a body that came bit by bit from their newest look (the plain sign), or one at their place and size;
    // never one that went on from the body withheld (across a long wait the person's newest look is old).
    const continues = (from: Look, x: Seen & { readonly look: Look }): boolean => bodyChange(from, x.look, frame.down, this.limits)?.changed !== true;
    const atPlace = (x: Seen & { readonly look: Look }): boolean => {
      const d = fromPlace(x.look, person);
      return d.metres <= this.limits.room && d.size <= this.limits.sizeRoom;
    };
    const other = this.other;
    const withheld = other === null ? [] : readable.filter((x) => continues(other.look, x));
    const back = readable.filter((x) => !withheld.includes(x) && (continues(person, x) || atPlace(x)));
    if (back.length > 0) {
      const going = back.filter((x) => continues(person, x));
      const s = nearest(going.length > 0 ? going : back, person.middle);
      return this.given(s.person, s.look, t, false);
    }
    if (readable.length === 0) {
      // No size can be read: the stream goes on only where the person was given in the picture before, one body seen.
      const only = seen[0];
      return this.lastFrame?.status === "person" && seen.length === 1 && only !== undefined ? this.given(only.person, null, t, false) : none("unsure");
    }
    // Found after a picture with nobody, none of these: a new person, the largest (§11.8), every stage after this afresh.
    const before = this.lastFrame?.status;
    if (before === "nobody" || before === "unsure") {
      const s = largest(readable);
      this.recent = [];
      return this.given(s.person, s.look, t, true);
    }
    // Come all at once with no picture of nobody between: withheld while the person may come back; followed as long as
    // bones are remembered while the person is not seen, the set's person instead, afresh.
    const s = other !== null && withheld.length > 0 ? nearest(withheld, other.look.middle) : largest(readable);
    const since = other !== null && withheld.includes(s) ? other.since : t;
    this.other = { look: s.look, since };
    const unseenFor = this.seenAt === null ? Number.POSITIVE_INFINITY : t - this.seenAt;
    if (t - since >= this.limits.takeOver && unseenFor >= this.limits.takeOver) {
      this.recent = [];
      return this.given(s.person, s.look, t, true);
    }
    return none("other");
  }
}
