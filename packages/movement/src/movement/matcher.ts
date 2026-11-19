// The movement matcher (spec Part 2 §12.2 stage 5, §12.1): reads one movement (§12.3) and, frame by frame, answers the
// three questions in order: can I see this person well enough; is the body in this movement's position and moving its
// way; only then, count. It never works from a list of wrong movements: a rep counts only when every rule of the
// movement held, and every other movement, whatever it is, ends as "not this movement", with no count and no word.
//
// What it reads: the steady points (for where the feet are) and the body measures of each frame (50c), the same list
// for every movement; nothing here names a movement or an exercise. Every wait is a time, never a count of frames.
//
// A rep, as the matcher follows it:
//   - waiting: the person has not yet stood ready: every condition of the movement's `ready` held, and the drive (the
//     measure whose fall is the rep) stayed still for a moment. Where they stood is remembered: the drive's value, each
//     height a rule watches, where the feet were. That is the person's own body: a rep is measured from it;
//   - in a rep: from the drive falling past half of the movement's depth, to it coming back within a quarter of it;
//   - then a moment more, so a jump from the top is seen, and the rep is judged by every rule;
//   - a rep whose drive is not seen for longer than a moment, or that lasts longer than any rep, decides nothing.
import type { Movement, MovementRead, MovementReady, MovementRule } from "@app/shared";
import { KP } from "@app/shared";
import { MEASURE_LIST, type MeasureName, type MeasuredBody, type Reading } from "../body/measures.js";
import type { SteadyBody } from "../body/steady.js";

/** The matcher's own waits and shares, the same for every movement. */
export interface MatchLimits {
  /** Standing ready: the drive stays within this of itself for `stillFor`, in its unit (legs for a height). */
  readonly still: number;
  readonly stillFor: number;
  /** A rep begins when the drive has fallen this share of the movement's depth, and is back once it has come within
   *  `endShare` of standing: of the movement's depth, or of the rep's own deepest, whichever is more. */
  readonly startShare: number;
  readonly endShare: number;
  /** After the drive is back, the rep is watched this long more before it is judged, ms. */
  readonly after: number;
  /** The bottom: the frames whose drop lies within this share of the deepest. */
  readonly bottomBand: number;
  /** A rep whose drive is not seen for longer than this decides nothing, ms; a person gone longer is waited for
   *  afresh. */
  readonly lost: number;
  /** A rep longer than this decides nothing, ms. */
  readonly longest: number;
  /** A rule over the whole rep that the camera must see is unseen when its readings break off, anywhere in the rep
   *  or the moment after, for longer than this, ms, or than one and a half of the rep's own frame steps, whichever
   *  is longer: a jump whose feet are hidden in the air is never let through. */
  readonly gap: number;
  /** A standing lower than the highest remembered (`anchor`), by more than `still`, is taken only once held
   *  for this long, ms: a slow descent shakes no more than standing does, and must never become the new standing,
   *  whether at once or in small steps. */
  readonly lower: number;
  /** A rep that tried: not counted for falling short ("short", with its reason) only when every count rule went at
   *  least this share of the way from standing to its number; a shallower dip is another movement, with no word. */
  readonly tried: number;
}

/**
 * Where each number comes from. `still`: a standing person's hips shake on the picture by about 0.01 of a leg from
 * frame to frame on Kd's videos; 0.03 is three times that, and less than a jump moves them in the 0.2 s around its
 * top (½·9.81·0.1² = 5 cm, about 0.06 of a leg). `stillFor`: 0.2 s of seen time, six frames at 30 a second; at the slowest
 * the engine takes, 8 a second, the frames spanning it are three (the window always keeps the newest frame older than
 * it, so a slow phone is never refused standing). `startShare` and `endShare`: halfway down starts a rep, so the shake of standing never does, and a
 * quarter of the way is back up (of a deep rep, a quarter of its own depth), but never below the line where a rep starts:
 * a person who stands up to 0.08 of a leg less tall after a rep is back; one who stays lower is not back until they stand
 * up, so a rep is never judged half way up and another begun there. `after`: measured on Kd's four squat-jump videos
 * (2026-11-19), the feet are 0.05 of a leg up from 167 ms before to 200 ms after the hips are three quarters back up, in
 * 18 take-offs of 19 (the 19th, 433 ms, is the video with a mirror); 0.3 s covers every one but that. `bottomBand`: a
 * tenth of the deepest. `lost`: half a second. `longest`: 15 s, longer than any held rep a movement of this kind has.
 * `gap`: 0.1 s, three frames at 30 a second. `lower`: a second, longer than any
 * pause at the bottom of a rep on Kd's videos. `tried`: three quarters of the way: advice is strict (§12.1), so a dip in doubt is silent (a
 * barbell good morning's knees went exactly half way).
 */
export const MATCH_LIMITS: MatchLimits = {
  still: 0.03,
  stillFor: 200,
  startShare: 0.5,
  endShare: 0.25,
  after: 300,
  bottomBand: 0.1,
  lost: 500,
  longest: 15000,
  gap: 100,
  lower: 1000,
  tried: 0.75,
};

export type Verdict =
  /** every rule held */
  | "counted"
  /** the movement matched, but did not go far enough: not counted, with the rule that fell short */
  | "short"
  /** another movement: no count and no word */
  | "other"
  /** the camera could not see what a rule needs: nothing decided */
  | "unseen";

export interface RepResult {
  readonly start: number;
  readonly end: number;
  readonly verdict: Verdict;
  /** The rule that decided a rep not counted; null when counted. */
  readonly rule: string | null;
  /** Every rule's reading of this rep, null where not seen. */
  readonly readings: Readonly<Record<string, number | null>>;
  /** Every rule's reading while the person stood ready before it (a drop, a rise, a change, a lift, a travel and a time
   *  are 0). */
  readonly standing: Readonly<Record<string, number | null>>;
}

export type MatchState = "waiting" | "ready" | "rep";

export interface MatchFrame {
  readonly t: number;
  readonly state: MatchState;
  /** Reps counted so far. */
  readonly count: number;
  /** How far down the rep is, 1 at the movement's depth; null when not in a rep or not seen. */
  readonly progress: number | null;
  /** A rep that was judged in this frame. */
  readonly rep: RepResult | null;
}

const KNOWN: ReadonlySet<string> = new Set(MEASURE_LIST.map((m) => m.name));
/** Where the feet touch the floor: heels and toes. Not the ankles: in a deep squat the pose model's ankle point slides
 *  forward with the shin while the foot stays flat (on Kd's fresh barbell back squat, 8 to 12 cm). */
const FEET: readonly number[] = [KP.left_heel, KP.left_foot_index, KP.right_heel, KP.right_foot_index];
/** Each foot's heel and toes, as places in `FEET`. */
const FOOT_ENDS: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
];

function namesOf(read: MovementRead): string[] {
  switch (read.kind) {
    case "value":
    case "rise":
    case "change":
      return read.measures;
    case "gap":
      return [...read.from, ...read.less];
    case "apart":
      return [read.measure];
    default:
      return [];
  }
}

const UNIT: ReadonlyMap<string, string> = new Map(MEASURE_LIST.map((m) => [m.name, m.unit]));
/** A height of one part above the floor, in legs: what the drive and a rise read (the still limit is in legs). */
const isHeight = (name: string): boolean => UNIT.get(name) === "legs" && !name.includes("against");
const isLeftAgainstRight = (name: string): boolean => name.includes("left against right");

/** Refuses a movement the engine cannot read rightly: a measure it does not have would read nothing and decide
 *  nothing; a drive or rise on anything but a height, or "apart" on anything but a left-against-right measure, would
 *  read in the wrong unit. */
export function checkMovement(movement: Movement): void {
  const names = [movement.drive.measure, ...movement.ready.flatMap((r) => namesOf(r.read)), ...movement.rules.flatMap((r) => namesOf(r.read))];
  const unknown = names.filter((n) => !KNOWN.has(n));
  if (unknown.length > 0) throw new Error(`${movement.name} names measures the engine does not have: ${unknown.join(", ")}.`);
  const wrong = [
    ...(isHeight(movement.drive.measure) ? [] : [`the drive, ${movement.drive.measure}, is not a height`]),
    ...movement.rules.flatMap((r) => {
      if (r.read.kind === "rise") return r.read.measures.filter((n) => !isHeight(n)).map((n) => `"${r.name}" rises on ${n}, not a height`);
      if (r.read.kind === "apart" && !isLeftAgainstRight(r.read.measure)) return [`"${r.name}" reads ${r.read.measure}, not left against right`];
      return [];
    }),
  ];
  if (wrong.length > 0) throw new Error(`${movement.name}: ${wrong.join("; ")}.`);
}

function isMeasure(name: string): name is MeasureName {
  return KNOWN.has(name);
}

/** One measure's reading this frame; none for a name the engine does not have (`checkMovement` refuses those). */
function readingOf(measured: MeasuredBody, name: string): Reading | undefined {
  return isMeasure(name) ? measured.readings.get(name) : undefined;
}

/** The picture's reading where the picture gives it, else the 3D one. */
const either = (r: Reading | undefined): number | null => (r === undefined ? null : (r.flat ?? r.world));

function mean(values: readonly (number | null)[]): number | null {
  const seen = values.filter((v): v is number => v !== null);
  return seen.length === 0 ? null : seen.reduce((a, b) => a + b, 0) / seen.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Where the person stood ready: the drive, each watched height, the feet on the picture (picture heights) and the
 *  body's size then (picture heights a metre). */
interface Standing {
  readonly t: number;
  readonly drive: number;
  readonly size: number;
  readonly heights: ReadonlyMap<string, number>;
  readonly feet: readonly ({ readonly x: number; readonly y: number } | null)[];
  readonly reads: Readonly<Record<string, number | null>>;
}

interface Sample {
  readonly t: number;
  readonly drop: number | null;
  readonly reads: Readonly<Record<string, number | null>>;
}

interface Rep {
  readonly start: number;
  /** Where the person stood ready, with the feet where they were at the top of the rep before (or while standing
   *  ready, for the first): feet stay in place through a rep and its way up, and a person doing reps with no still
   *  moment between them may drift a little from rep to rep without that adding up. */
  readonly standing: Standing;
  samples: Sample[];
  lastSeen: number;
  /** When the drive came back; null while still down. */
  back: number | null;
  /** For each foot point, the lowest it has been on the picture during this rep, along "down" (picture heights), since
   *  it was last hidden for longer than a gap (`gap`, or 1.5 frame steps): a point that comes back from a long hide is
   *  the model's new guess (side on, the far foot comes back 4 to 7 cm higher on the picture), never a foot that rose;
   *  a flicker of a frame or two keeps it, or a hop whose feet flicker in the air would be measured from the air. */
  low: (number | null)[];
  /** For each foot point, when it was last seen in this rep, ms. */
  seenAt: (number | null)[];
}

/** One frame as the matcher keeps it for the still check. */
interface Recent {
  readonly t: number;
  readonly drive: number | null;
  readonly ready: boolean;
  readonly heights: ReadonlyMap<string, number>;
  readonly feet: readonly ({ readonly x: number; readonly y: number } | null)[];
  readonly size: number | null;
  readonly measured: MeasuredBody;
}

export class MovementMatcher {
  private readonly depth: number;
  private readonly watched: readonly string[];
  private recent: Recent[] = [];
  /** The highest standing since the stream began, or since a lower one was held for `lower`: standing never creeps
   *  below it. */
  private anchor: number | null = null;
  /** The drive and whether the person stood ready, over the last `lower` and the newest frame older than that. */
  private held: { readonly t: number; readonly drive: number | null; readonly ready: boolean }[] = [];
  private standing: Standing | null = null;
  private rep: Rep | null = null;
  private count = 0;
  private lastT: number | null = null;
  private lastDrive: number | null = null;
  /** "Down" as the picture shows it this frame, a unit vector; null when not known. */
  private flatDown: readonly [number, number] | null = null;
  /** Where the feet were at the latest top: while standing ready, or as the last rep came back up. */
  private topFeet: readonly ({ readonly x: number; readonly y: number } | null)[] = [];

  constructor(
    private readonly movement: Movement,
    private readonly limits: MatchLimits = MATCH_LIMITS,
  ) {
    checkMovement(movement);
    const depthRule = movement.rules.find((r) => r.read.kind === "drop" && r.role === "count" && r.atLeast !== undefined);
    if (depthRule?.atLeast === undefined || !(depthRule.atLeast > 0)) throw new Error(`${movement.name} has no depth to count a rep by.`);
    this.depth = depthRule.atLeast;
    this.watched = [...new Set(movement.rules.flatMap((r) => (r.read.kind === "rise" || r.read.kind === "change" ? r.read.measures : [])))];
  }

  next(body: SteadyBody, measured: MeasuredBody): MatchFrame {
    const t = measured.t;
    // A frame with the same time as the one before decides nothing (the possible-body check refuses it whole); only a
    // clock that went back is a new stream.
    if (this.lastT !== null && t === this.lastT) return this.still(t);
    if (this.lastT !== null && t < this.lastT) this.reset();
    this.lastT = t;
    const L = this.limits;
    const drive = readingOf(measured, this.movement.drive.measure)?.flat ?? null;
    if (drive !== null) this.lastDrive = t;
    const heights = new Map<string, number>();
    for (const name of this.watched) {
      const h = readingOf(measured, name)?.flat ?? null;
      if (h !== null) heights.set(name, h);
    }
    // Where the feet are on the picture, in picture heights. Their movement is measured against the body's size while
    // it stood ready, never this frame's: from the front, a squat's thighs shorten on the picture and the size read
    // from them falls, which would make still feet look as though they moved.
    const feet = FEET.map((i) => {
      const p = body.points[i] ?? null;
      return p === null ? null : { x: p.x * body.aspect, y: p.y };
    });
    const dx = body.down?.[0] ?? 0;
    const dy = body.down?.[1] ?? 0;
    const dn = Math.hypot(dx, dy);
    this.flatDown = body.down === null || !(dn > 0) ? null : [dx / dn, dy / dn];
    const ready = this.movement.ready.every((c) => this.holds(c, measured));
    this.recent.push({ t, drive, ready, heights, feet, size: body.size, measured });
    // The last `stillFor` of frames, and the newest one older than that, so the window always spans `stillFor` of seen
    // time however few frames a second the phone gives.
    const inside = this.recent.filter((r) => t - r.t <= L.stillFor);
    const older = this.recent.filter((r) => t - r.t > L.stillFor);
    const edge = older[older.length - 1];
    this.recent = edge === undefined ? inside : [edge, ...inside];
    this.held.push({ t, drive, ready });
    const heldOlder = this.held.filter((h) => t - h.t > L.lower);
    const heldEdge = heldOlder[heldOlder.length - 1];
    this.held = [...(heldEdge === undefined ? [] : [heldEdge]), ...this.held.filter((h) => t - h.t <= L.lower)];

    // A person gone longer than a moment is waited for afresh.
    if (this.lastDrive === null || t - this.lastDrive > L.lost) {
      this.standing = null;
      if (this.rep !== null) return this.end(t, this.judgeUnseen(this.rep, t));
    }

    let judged: RepResult | null = null;
    const rep = this.rep;
    if (rep !== null) {
      const drop = drive === null ? null : rep.standing.drive - drive;
      rep.samples.push({ t, drop, reads: this.readAll(measured, rep, feet, heights) });
      if (drop !== null) rep.lastSeen = t;
      if (t - rep.start > L.longest || t - rep.lastSeen > L.lost) return this.end(t, this.judgeUnseen(rep, t));
      if (rep.back === null) {
        // Back: within a quarter of standing (of a deep rep, of its own depth), and always above the line where a rep
        // starts, so a rep is never judged half way up and another begun there.
        if (drop !== null && drop <= Math.min(L.startShare * this.depth, L.endShare * Math.max(this.depth, this.deepest(rep)))) {
          rep.back = t;
          this.topFeet = this.topFeet.length === 0 ? feet : feet.map((p, k) => p ?? this.topFeet[k] ?? null);
        }
      } else if (drop !== null && drop >= L.startShare * this.depth) {
        // The next rep began before this one's moment after: judge this one on what it had, and start the next.
        judged = this.judge(rep);
        const origin = this.originOf(rep.standing);
        const next: Rep = { start: t, standing: origin, samples: [], lastSeen: t, back: null, low: [], seenAt: [] };
        next.samples.push({ t, drop, reads: this.readAll(measured, next, feet, heights) });
        this.rep = next;
        return this.frame(t, drop, judged);
      } else if (t - rep.back >= L.after) {
        judged = this.judge(rep);
        this.rep = null;
      }
      if (this.rep !== null) return this.frame(t, drop, null);
    }

    // Not in a rep: standing ready is remembered afresh whenever it holds.
    const found = this.stillStanding();
    const anchor = this.anchor;
    let still: Standing | null = found;
    if (found !== null && anchor !== null && found.drive < anchor) {
      // Lower than the highest standing since the last rep: within the shake of it, it is that same standing; further
      // down, it is taken only once held there for `lower`.
      if (found.drive >= anchor - L.still) still = { ...found, drive: anchor };
      else if (!this.heldLow()) still = null;
    }
    if (still !== null) this.anchor = still.drive;
    if (still !== null) {
      this.standing = still;
      this.topFeet = still.feet;
    }
    const standing = this.standing;
    if (standing !== null && drive !== null && standing.drive - drive >= L.startShare * this.depth) {
      const origin = this.originOf(standing);
      const fresh: Rep = { start: t, standing: origin, samples: [], lastSeen: t, back: null, low: [], seenAt: [] };
      fresh.samples.push({ t, drop: standing.drive - drive, reads: this.readAll(measured, fresh, feet, heights) });
      this.rep = fresh;
      return this.frame(t, standing.drive - drive, judged);
    }
    return this.frame(t, null, judged);
  }

  private originOf(standing: Standing): Standing {
    return { ...standing, feet: standing.feet.map((then, k) => this.topFeet[k] ?? then) };
  }

  /** The set has ended: a rep back up for the whole moment after is judged now; one still down, or back up too
   *  lately for a jump from its top to have shown, is not judged. */
  finish(): MatchFrame | null {
    const rep = this.rep;
    const last = this.lastT;
    if (rep === null || last === null) return null;
    this.rep = null;
    return rep.back === null || last - rep.back < this.limits.after ? null : this.frame(last, null, this.judge(rep));
  }

  /** A frame that decides nothing. */
  private still(t: number): MatchFrame {
    const state: MatchState = this.rep !== null ? "rep" : this.standing !== null ? "ready" : "waiting";
    return { t, state, count: this.count, progress: null, rep: null };
  }

  private deepest(rep: Rep): number {
    return Math.max(0, ...rep.samples.map((s) => s.drop ?? 0));
  }

  /** A clock that went back is a new stream of frames: nothing of the old one is carried, its count included. */
  private reset(): void {
    this.count = 0;
    this.topFeet = [];
    this.anchor = null;
    this.recent = [];
    this.held = [];
    this.standing = null;
    this.rep = null;
    this.lastDrive = null;
  }

  private end(t: number, result: RepResult): MatchFrame {
    this.rep = null;
    return this.frame(t, null, result);
  }

  private frame(t: number, drop: number | null, rep: RepResult | null): MatchFrame {
    if (rep?.verdict === "counted") this.count++;
    const state: MatchState = this.rep !== null ? "rep" : this.standing !== null ? "ready" : "waiting";
    return { t, state, count: this.count, progress: this.rep !== null && drop !== null ? drop / this.depth : null, rep };
  }

  /** Whether the person has stood ready, the drive seen and still, for the whole of the last `lower`. */
  private heldLow(): boolean {
    const L = this.limits;
    const first = this.held[0];
    const last = this.held[this.held.length - 1];
    if (first === undefined || last === undefined || last.t - first.t < L.lower) return false;
    if (!this.held.every((h) => h.ready && h.drive !== null)) return false;
    const drives = this.held.map((h) => h.drive ?? 0);
    return Math.max(...drives) - Math.min(...drives) <= L.still;
  }

  /** Every recent frame stood ready, with the drive seen and still: where the person stands. */
  private stillStanding(): Standing | null {
    const L = this.limits;
    const frames = this.recent;
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (first === undefined || last === undefined || last.t - first.t < L.stillFor) return null;
    if (!frames.every((f) => f.ready && f.drive !== null && f.size !== null)) return null;
    const drives = frames.map((f) => f.drive ?? 0);
    if (Math.max(...drives) - Math.min(...drives) > L.still) return null;
    const heights = new Map<string, number>();
    for (const name of this.watched) {
      const m = median(frames.flatMap((f) => (f.heights.has(name) ? [f.heights.get(name) ?? 0] : [])));
      if (m !== null) heights.set(name, m);
    }
    const feet = FEET.map((_, k) => {
      const seen = frames.flatMap((f) => {
        const p = f.feet[k] ?? null;
        return p === null ? [] : [p];
      });
      const x = median(seen.map((p) => p.x));
      const y = median(seen.map((p) => p.y));
      return x === null || y === null ? null : { x, y };
    });
    const drive = median(drives) ?? 0;
    const size = median(frames.map((f) => f.size ?? 0)) ?? 0;
    const partial: Standing = { t: last.t, drive, size, heights, feet, reads: {} };
    const reads: Record<string, number | null> = {};
    for (const rule of this.movement.rules) {
      reads[rule.name] = ["drop", "rise", "change", "lift", "travel", "time"].includes(rule.read.kind) ? 0 : median(frames.flatMap((f) => {
        const v = this.read(rule.read, f.measured, partial, f.feet, f.heights);
        return v === null ? [] : [v];
      }));
    }
    return { ...partial, reads };
  }

  private holds(c: MovementReady, measured: MeasuredBody): boolean {
    const v = this.read(c.read, measured, null, [], new Map());
    if (v === null) return false;
    return (c.atLeast === undefined || v >= c.atLeast) && (c.atMost === undefined || v <= c.atMost);
  }

  private readAll(
    measured: MeasuredBody,
    rep: Rep,
    feet: readonly ({ readonly x: number; readonly y: number } | null)[],
    heights: ReadonlyMap<string, number>,
  ): Record<string, number | null> {
    const lift = this.liftOf(rep, measured.t, feet);
    const reads: Record<string, number | null> = {};
    for (const rule of this.movement.rules) reads[rule.name] = rule.read.kind === "lift" ? lift : this.read(rule.read, measured, rep.standing, feet, heights);
    return reads;
  }

  /** How far the body's feet are above the lowest place each reached during this same rep, along "down", metres
   *  against the body's size while standing: for each foot the lesser of its heel and toes, and the lesser of the two
   *  feet where both are seen. Never from the top of the rep before: in reps with no pause between them, a hop's feet
   *  are already leaving the floor as the rep before comes back up, while at the bottom of a rep they are on the floor. */
  private liftOf(rep: Rep, t: number, feet: readonly ({ readonly x: number; readonly y: number } | null)[]): number | null {
    const d = this.flatDown;
    const size = rep.standing.size;
    if (d === null || !(size > 0)) return null;
    // The rep's frame step from its last ten frames: the same cost on every frame, however long the rep.
    const times = rep.samples.slice(-10).map((s) => s.t);
    const steps = times.slice(1).map((x, k) => x - (times[k] ?? x));
    const longest = Math.max(this.limits.gap, 1.5 * (median(steps) ?? 0));
    // Each foot point's rise above its own lowest place in this rep, forgotten only after a hide longer than a gap.
    const rise = feet.map((p, k) => {
      if (p === null) return null;
      const seen = rep.seenAt[k] ?? null;
      if (seen !== null && t - seen > longest) rep.low[k] = null;
      rep.seenAt[k] = t;
      const along = p.x * d[0] + p.y * d[1];
      const low = Math.max(rep.low[k] ?? Number.NEGATIVE_INFINITY, along);
      rep.low[k] = low;
      return (low - along) / size;
    });
    // A foot has left the floor only when its heel AND its toes rose: in a squat one end may slide on the picture as
    // the shin tilts or the ankle bends; in a hop the whole foot goes up. And the body has left the floor only when
    // both feet did, the lesser of the two where both are seen: side on, the far foot, half hidden behind the near
    // one, wanders 4 to 5 cm on the picture at the bottom of a real squat (Kd's side-on man) while the near one stays.
    // One foot lifted alone (a step, a lunge) is the other rules' to refuse.
    const lifted = FOOT_ENDS.flatMap(([heel, toes]) => {
      const a = rise[heel] ?? null;
      const b = rise[toes] ?? null;
      return a === null || b === null ? [] : [Math.min(a, b)];
    });
    return lifted.length === 0 ? null : Math.min(...lifted);
  }

  private read(
    read: MovementRead,
    measured: MeasuredBody,
    standing: Standing | null,
    feet: readonly ({ readonly x: number; readonly y: number } | null)[],
    heights: ReadonlyMap<string, number>,
  ): number | null {
    const get = (name: string): number | null => either(readingOf(measured, name));
    switch (read.kind) {
      case "drop": {
        const d = readingOf(measured, this.movement.drive.measure)?.flat ?? null;
        return d === null || standing === null ? null : standing.drive - d;
      }
      case "value":
        return mean(read.measures.map(get));
      case "gap":
        return mean(
          read.from.map((a, k) => {
            const x = get(a);
            const b = read.less[k];
            const y = b === undefined ? null : get(b);
            return x === null || y === null ? null : x - y;
          }),
        );
      case "apart": {
        // Both readings must see the sides differ: a limb pointing at the camera can look straight on the picture
        // while it is bent (on Kd's videos a man's left hip read 173° on the picture and 137° in 3D, his right 120°).
        const r = readingOf(measured, read.measure);
        const seen = [r?.flat ?? null, r?.world ?? null].filter((v): v is number => v !== null).map(Math.abs);
        return seen.length === 0 ? null : Math.min(...seen);
      }
      case "rise": {
        if (standing === null) return null;
        const rises = read.measures.flatMap((name) => {
          const now = heights.get(name);
          const then = standing.heights.get(name);
          return now === undefined || then === undefined ? [] : [now - then];
        });
        return rises.length === 0 ? null : Math.max(...rises);
      }
      case "change": {
        if (standing === null) return null;
        const moved = read.measures.flatMap((name) => {
          const now = heights.get(name);
          const then = standing.heights.get(name);
          return now === undefined || then === undefined ? [] : [Math.abs(now - then)];
        });
        return moved.length === 0 ? null : Math.max(...moved);
      }
      case "lift":
        // Read over a rep only (`liftOf`): while standing ready there is no rep to have a lowest place.
        return null;
      case "travel": {
        if (standing === null) return null;
        if (!(standing.size > 0)) return null;
        const moved = feet.flatMap((p, k) => {
          const then = standing.feet[k] ?? null;
          return p === null || then === null ? [] : [Math.hypot(p.x - then.x, p.y - then.y) / standing.size];
        });
        return moved.length === 0 ? null : Math.max(...moved);
      }
      case "time":
        return null;
    }
  }

  private statOf(rule: MovementRule, rep: Rep): number | null {
    const L = this.limits;
    const samples = rep.samples;
    if (rule.read.kind === "time") return ((rep.back ?? samples[samples.length - 1]?.t ?? rep.start) - rep.start) / 1000;
    if (rule.at === "bottom") {
      const deepest = Math.max(...samples.map((s) => s.drop ?? Number.NEGATIVE_INFINITY));
      if (!Number.isFinite(deepest)) return null;
      const bottom = samples.filter((s) => s.drop !== null && s.drop >= deepest * (1 - L.bottomBand));
      return median(bottom.flatMap((s) => {
        const v = s.reads[rule.name] ?? null;
        return v === null ? [] : [v];
      }));
    }
    const read = samples.flatMap((s) => {
      const v = s.reads[rule.name] ?? null;
      return v === null ? [] : [{ t: s.t, v }];
    });
    if (read.length === 0) return null;
    if (rule.seen === "always" && this.brokenOff(read.map((r) => r.t), rep)) return null;
    const values = read.map((r) => r.v);
    return rule.atLeast !== undefined ? Math.min(...values) : Math.max(...values);
  }

  /** Whether readings at these times break off anywhere from the rep's start to its last frame (the moment after
   *  included) for longer than `gap`, or one and a half of the rep's own frame steps. */
  private brokenOff(times: readonly number[], rep: Rep): boolean {
    const all = rep.samples.map((s) => s.t);
    const steps = all.slice(1).map((t, k) => t - (all[k] ?? t));
    const longest = Math.max(this.limits.gap, 1.5 * (median(steps) ?? 0));
    const marks = [rep.start, ...times, all[all.length - 1] ?? rep.start];
    return marks.slice(1).some((t, k) => t - (marks[k] ?? t) > longest);
  }

  private judge(rep: Rep): RepResult {
    const readings: Record<string, number | null> = {};
    for (const rule of this.movement.rules) readings[rule.name] = this.statOf(rule, rep);
    const end = rep.back ?? rep.samples[rep.samples.length - 1]?.t ?? rep.start;
    const base = { start: rep.start, end, readings, standing: rep.standing.reads };
    const failing = (role: MovementRule["role"]): MovementRule | undefined =>
      this.movement.rules.find((r) => {
        if (r.role !== role) return false;
        const v = readings[r.name] ?? null;
        if (v === null) return false;
        return (r.atLeast !== undefined && v < r.atLeast) || (r.atMost !== undefined && v > r.atMost);
      });
    const unseen = this.movement.rules.find((r) => r.seen === "always" && (readings[r.name] ?? null) === null);
    if (unseen !== undefined) return { ...base, verdict: "unseen", rule: unseen.name };
    const other = failing("match");
    if (other !== undefined) return { ...base, verdict: "other", rule: other.name };
    const short = failing("count");
    if (short === undefined) return { ...base, verdict: "counted", rule: null };
    // "Short" is a word for the person ("Go lower to count"): only for a rep that plainly tried, every count rule at
    // least `tried` of the way from standing to its number. A shallower dip is another movement, with no word.
    const untried = this.movement.rules.find((r) => {
      if (r.role !== "count") return false;
      const v = readings[r.name] ?? null;
      const from = rep.standing.reads[r.name] ?? null;
      const bound = r.atLeast ?? r.atMost;
      if (v === null || from === null || bound === undefined || bound === from) return false;
      return (v - from) / (bound - from) < this.limits.tried;
    });
    if (untried !== undefined) return { ...base, verdict: "other", rule: untried.name };
    return { ...base, verdict: "short", rule: short.name };
  }

  private judgeUnseen(rep: Rep, t: number): RepResult {
    const readings: Record<string, number | null> = {};
    for (const rule of this.movement.rules) readings[rule.name] = null;
    return { start: rep.start, end: t, verdict: "unseen", rule: null, readings, standing: rep.standing.reads };
  }
}
