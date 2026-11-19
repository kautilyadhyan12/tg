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
  /** A rule the camera must see is seen when it is read in at least this share of the frames it is judged on. */
  readonly seenShare: number;
}

/**
 * Where each number comes from. `still`: a standing person's hips shake on the picture by about 0.01 of a leg from
 * frame to frame on Kd's videos; 0.03 is three times that, and less than a jump moves them in the 0.2 s around its
 * top (½·9.81·0.1² = 5 cm, about 0.06 of a leg). `stillFor`: 0.2 s, six frames at 30 a second, two at the slowest the
 * engine takes. `startShare` and `endShare`: halfway down starts a rep, so the shake of standing never does, and a
 * quarter of the way is back up (of a deep rep, a quarter of its own depth), so a person who stands a little less tall
 * after a rep is back. `after`: a jump's
 * take-off comes as the legs straighten; 0.3 s later its feet are 15 cm up (½·9.81·0.3² is more than the jump
 * needs to leave the floor by the rise rule's margin). `bottomBand`: a tenth of the deepest. `lost`: half a second.
 * `longest`: 15 s, longer than any held rep a movement of this kind has. `seenShare`: half.
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
  seenShare: 0.5,
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
  /** Every rule's reading while the person stood ready before it (a drop, a rise, a change, a travel and a time are 0). */
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

/** Refuses a movement naming a measure the engine does not have: it would read nothing and decide nothing. */
export function checkMovement(movement: Movement): void {
  const names = [movement.drive.measure, ...movement.ready.flatMap((r) => namesOf(r.read)), ...movement.rules.flatMap((r) => namesOf(r.read))];
  const unknown = names.filter((n) => !KNOWN.has(n));
  if (unknown.length > 0) throw new Error(`${movement.name} names measures the engine does not have: ${unknown.join(", ")}.`);
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
  private standing: Standing | null = null;
  private rep: Rep | null = null;
  private count = 0;
  private lastT: number | null = null;
  private lastDrive: number | null = null;
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
    if (this.lastT !== null && t <= this.lastT) this.reset();
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
    const ready = this.movement.ready.every((c) => this.holds(c, measured));
    this.recent.push({ t, drive, ready, heights, feet, size: body.size, measured });
    this.recent = this.recent.filter((r) => t - r.t <= L.stillFor);

    // A person gone longer than a moment is waited for afresh.
    if (this.lastDrive === null || t - this.lastDrive > L.lost) {
      this.standing = null;
      if (this.rep !== null) return this.end(t, this.judgeUnseen(this.rep, t));
    }

    let judged: RepResult | null = null;
    const rep = this.rep;
    if (rep !== null) {
      const drop = drive === null ? null : rep.standing.drive - drive;
      rep.samples.push({ t, drop, reads: this.readAll(measured, rep.standing, feet, heights) });
      if (drop !== null) rep.lastSeen = t;
      if (t - rep.start > L.longest || t - rep.lastSeen > L.lost) return this.end(t, this.judgeUnseen(rep, t));
      if (rep.back === null) {
        if (drop !== null && drop <= L.endShare * Math.max(this.depth, this.deepest(rep))) {
          rep.back = t;
          this.topFeet = this.topFeet.length === 0 ? feet : feet.map((p, k) => p ?? this.topFeet[k] ?? null);
        }
      } else if (drop !== null && drop >= L.startShare * this.depth) {
        // The next rep began before this one's moment after: judge this one on what it had, and start the next.
        judged = this.judge(rep);
        const origin = this.originOf(rep.standing);
        this.rep = { start: t, standing: origin, samples: [{ t, drop, reads: this.readAll(measured, origin, feet, heights) }], lastSeen: t, back: null };
        return this.frame(t, drop, judged);
      } else if (t - rep.back >= L.after) {
        judged = this.judge(rep);
        this.rep = null;
      }
      if (this.rep !== null) return this.frame(t, drop, null);
    }

    // Not in a rep: standing ready is remembered afresh whenever it holds.
    const still = this.stillStanding();
    if (still !== null) {
      this.standing = still;
      this.topFeet = still.feet;
    }
    const standing = this.standing;
    if (standing !== null && drive !== null && standing.drive - drive >= L.startShare * this.depth) {
      const origin = this.originOf(standing);
      this.rep = { start: t, standing: origin, samples: [{ t, drop: standing.drive - drive, reads: this.readAll(measured, origin, feet, heights) }], lastSeen: t, back: null };
      return this.frame(t, standing.drive - drive, judged);
    }
    return this.frame(t, null, judged);
  }

  private originOf(standing: Standing): Standing {
    return { ...standing, feet: standing.feet.map((then, k) => this.topFeet[k] ?? then) };
  }

  /** The set has ended: a rep already back up is judged now; one still down is not a rep. */
  finish(): MatchFrame | null {
    const rep = this.rep;
    if (rep === null || this.lastT === null) return null;
    this.rep = null;
    return rep.back === null ? null : this.frame(this.lastT, null, this.judge(rep));
  }

  private deepest(rep: Rep): number {
    return Math.max(0, ...rep.samples.map((s) => s.drop ?? 0));
  }

  /** A clock that went back is a new stream of frames: nothing of the old one is carried, its count included. */
  private reset(): void {
    this.count = 0;
    this.topFeet = [];
    this.recent = [];
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

  /** Every recent frame stood ready, with the drive seen and still: where the person stands. */
  private stillStanding(): Standing | null {
    const L = this.limits;
    const frames = this.recent;
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (first === undefined || last === undefined || last.t - first.t < L.stillFor * 0.75) return null;
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
      reads[rule.name] = ["drop", "rise", "change", "travel", "time"].includes(rule.read.kind) ? 0 : median(frames.flatMap((f) => {
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
    standing: Standing,
    feet: readonly ({ readonly x: number; readonly y: number } | null)[],
    heights: ReadonlyMap<string, number>,
  ): Record<string, number | null> {
    const reads: Record<string, number | null> = {};
    for (const rule of this.movement.rules) reads[rule.name] = this.read(rule.read, measured, standing, feet, heights);
    return reads;
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
    const values = samples.flatMap((s) => {
      const v = s.reads[rule.name] ?? null;
      return v === null ? [] : [v];
    });
    if (values.length === 0) return null;
    if (rule.seen === "always" && values.length < L.seenShare * samples.length) return null;
    return rule.atLeast !== undefined ? Math.min(...values) : Math.max(...values);
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
    if (short !== undefined) return { ...base, verdict: "short", rule: short.name };
    return { ...base, verdict: "counted", rule: null };
  }

  private judgeUnseen(rep: Rep, t: number): RepResult {
    const readings: Record<string, number | null> = {};
    for (const rule of this.movement.rules) readings[rule.name] = null;
    return { start: rep.start, end: t, verdict: "unseen", rule: null, readings, standing: rep.standing.reads };
  }
}
