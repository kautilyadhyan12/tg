// The lock's numbers (ROADMAP 52d-i, src/body/person.ts): once a set has counted, how far from where they exercised a
// person goes, and how much larger or smaller the camera reads them, on every proof set the camera counts or times.
//
// The rule, in words Kd can read. For each movement, each video it counts or times (its own, and its twins'), as filmed
// and as each replay that must hold: the set has counted at its first counted rep (a hold: its first held second); the
// person's place is the middle of where the trunk's middle lay over the second before, at the middle of their size then;
// and from then to the last rep the set told the person anything about (counted, short, or unseen; a hold: its last held
// picture), each picture's trunk's middle is so many metres from that place, at that size, and the body so many times
// larger or smaller. Each set gives its furthest. The bound is beyond the furthest set by half its distance from the
// middle set, as a movement's match rule is (movementCheck.ts), rounded up to 0.05 m and 0.05 times: a body further than
// that from the person's place, or larger or smaller than that, is never the person.
import type { HoldMovement, Movement } from "@app/shared";
import { HoldMatcher, LIMITS, MovementMatcher, PERSON_LIMITS, fromPlace, lookAt, type Look } from "../src/index.js";
import type { Video } from "./bodyCheck.js";
import { readMovementFile } from "./holdCheck.js";
import { runOf } from "./measureCheck.js";
import { LEAD_IN, countedTimes, proofVideos, seedOf, withLeadIn, type ProofVideo } from "./movementCheck.js";
import { REPLAYS, type Replay } from "./replays.js";

/** The movements the camera counts or times (the support hold is timed only: the camera judges nothing). */
export const LOCKED_MOVEMENTS = ["squat", "squat-jump", "lunge", "sit-up", "hip-thrust", "l-sit"] as const;

export interface LockRow {
  readonly movement: string;
  readonly label: string;
  /** The replay, or "as filmed". */
  readonly replay: string;
  /** When the set counted, seconds of the video's own clock. */
  readonly counted: number;
  /** The furthest from the place, metres, and the most times larger or smaller (1 or more), over the set. */
  readonly metres: number;
  readonly size: number;
  /** Pictures judged, and those whose size could not be read. */
  readonly pictures: number;
  readonly unread: number;
}

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** The frames from the set counting (`from`) to the last one it told the person about (`to`), indices in the video with
 *  its first and last pictures held (`withLeadIn`); null when it never counted. */
function spanOf(file: Movement | HoldMovement, video: Video): { readonly from: number; readonly to: number } | null {
  const { steady, measured } = runOf(video);
  let from: number | null = null;
  let to: number | null = null;
  if (file.counting === "hold") {
    const hold = new HoldMatcher(file);
    for (let i = 0; i < measured.length; i++) {
      const m = measured[i];
      if (m === undefined) continue;
      const f = hold.next(m);
      if (f.holding) {
        from ??= i;
        to = i;
      }
    }
  } else {
    const matcher = new MovementMatcher(file);
    for (let i = 0; i < steady.length; i++) {
      const s = steady[i];
      const m = measured[i];
      if (s === undefined || m === undefined) continue;
      const rep = matcher.next(s, m).rep;
      if (rep === null || rep.verdict === "other") continue;
      if (rep.verdict === "counted") from ??= i;
      if (from !== null) to = i;
    }
  }
  return from === null || to === null ? null : { from, to };
}

/** One set's row: how far the person went from their place, and how much their size changed, once it had counted. */
export function lockRow(file: Movement | HoldMovement, video: Video, replay: string): LockRow | null {
  const lead = withLeadIn(video);
  const span = spanOf(file, lead);
  if (span === null) return null;
  const looks = lead.frames.map((f): Look | null => {
    const p = f.people[0];
    return p === undefined ? null : lookAt(p, f.aspect, f.t, LIMITS.sure);
  });
  const at = lead.frames[span.from]?.t ?? 0;
  const before = looks.filter((l): l is Look => l !== null && l.t <= at && l.t > at - PERSON_LIMITS.place);
  if (before.length === 0) return null;
  const place = { middle: [median(before.map((l) => l.middle[0])), median(before.map((l) => l.middle[1]))] as const, size: median(before.map((l) => l.size)) };
  let metres = 0;
  let size = 1;
  let unread = 0;
  for (let i = span.from + 1; i <= span.to; i++) {
    const l = looks[i];
    if (lead.frames[i]?.people.length === 0) continue;
    if (l === undefined || l === null) {
      unread++;
      continue;
    }
    const d = fromPlace(l, place);
    metres = Math.max(metres, d.metres);
    size = Math.max(size, d.size);
  }
  const t0 = lead.frames[0]?.t ?? 0;
  return { movement: file.name, label: video.label, replay, counted: (at - t0 - LEAD_IN) / 1000, metres, size, pictures: span.to - span.from, unread };
}

/** The replays that must hold: those the proof table holds a count to. */
export const LOCK_REPLAYS: readonly Replay[] = REPLAYS.filter((r) => r.hold);

function replayedVideo(file: Movement | HoldMovement, v: ProofVideo, replay: Replay): Video {
  const t0 = v.video.frames[0]?.t ?? 0;
  const spans =
    file.counting === "hold" ? (v.entry.held ?? []).map(([a, b]) => ({ start: t0 + a * 1000, end: t0 + b * 1000 })) : countedTimes(file, v.video);
  return { ...v.video, frames: replay.edit(v.video.frames, seedOf(v.video.label, replay.name), spans) };
}

/** Every set's row, as filmed and under each replay that must hold. */
export function lockRows(videos: readonly ProofVideo[] = proofVideos(), replays: readonly Replay[] = LOCK_REPLAYS): LockRow[] {
  return LOCKED_MOVEMENTS.flatMap((name) => {
    const file = readMovementFile(name);
    if (file.counting === "timed only") return [];
    return videos.flatMap((v) => {
      const filmed = lockRow(file, v.video, "as filmed");
      if (filmed === null) return [];
      return [filmed, ...replays.flatMap((r) => lockRow(file, replayedVideo(file, v, r), r.name) ?? [])];
    });
  });
}

/** Rounded up to `step`. */
const upTo = (value: number, step: number): number => Math.round(Math.ceil(value / step - 1e-9) * step * 1e6) / 1e6;

export interface LockNumbers {
  readonly room: number;
  readonly sizeRoom: number;
  /** The furthest set and the middle set's furthest, each reading, and the sets. */
  readonly metres: { readonly furthest: number; readonly middle: number };
  readonly size: { readonly furthest: number; readonly middle: number };
  readonly sets: number;
}

/** The lock's two numbers by the rule above. */
export function lockNumbers(rows: readonly LockRow[]): LockNumbers {
  const metres = rows.map((r) => r.metres);
  const sizes = rows.map((r) => r.size);
  const furthest = Math.max(...metres);
  const middle = median(metres);
  const sizeFurthest = Math.max(...sizes);
  const sizeMiddle = median(sizes);
  return {
    room: upTo(furthest + (furthest - middle) / 2, 0.05),
    sizeRoom: upTo(sizeFurthest + (sizeFurthest - sizeMiddle) / 2, 0.05),
    metres: { furthest, middle },
    size: { furthest: sizeFurthest, middle: sizeMiddle },
    sets: rows.length,
  };
}

// ── Why not the body's own proportions ──────────────────────────────────────────────────
/** The bones whose 3D length, as a share of the trunk (shoulder to hip, both sides), might tell two people apart. */
export const PROPORTIONS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  shoulders: [[11, 12]],
  hips: [[23, 24]],
  "upper arm": [[11, 13], [12, 14]],
  forearm: [[13, 15], [14, 16]],
  thigh: [[23, 25], [24, 26]],
  shin: [[25, 27], [26, 28]],
};

export interface ProportionRow {
  readonly label: string;
  readonly person: string;
  /** Each bone's share of the trunk, the middle over the set; and the spread of its one-second middles within the set
   *  (5th to 95th hundredth, a share of the set's middle). */
  readonly middle: Readonly<Record<string, number>>;
  readonly withinSecond: Readonly<Record<string, number>>;
}

const quantile = (values: readonly number[], q: number): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
};

/** Each proof set's proportions, from its steady 3D points (the points the body check used). */
export function proportionRows(videos: readonly ProofVideo[] = proofVideos()): ProportionRow[] {
  return videos.map(({ entry, video }) => {
    const per: Record<string, number[]> = {};
    for (const s of runOf(video).steady) {
      const w = (i: number) => s.points[i]?.world ?? null;
      const len = (a: number, b: number): number | null => {
        const p = w(a);
        const q = w(b);
        return p === null || q === null ? null : Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      };
      const left = len(11, 23);
      const right = len(12, 24);
      if (left === null || right === null) continue;
      const trunk = (left + right) / 2;
      for (const [bone, pairs] of Object.entries(PROPORTIONS)) {
        const seen = pairs.flatMap(([a, b]) => {
          const l = len(a, b);
          return l === null ? [] : [l];
        });
        if (seen.length > 0) (per[bone] ??= []).push(seen.reduce((x, y) => x + y, 0) / seen.length / trunk);
      }
    }
    const middle: Record<string, number> = {};
    const withinSecond: Record<string, number> = {};
    for (const [bone, values] of Object.entries(per)) {
      const m = median(values);
      middle[bone] = m;
      const seconds: number[] = [];
      for (let i = 0; i + 30 <= values.length; i += 15) seconds.push(median(values.slice(i, i + 30)));
      if (seconds.length >= 3) withinSecond[bone] = (quantile(seconds, 0.95) - quantile(seconds, 0.05)) / m;
    }
    return { label: video.label, person: entry.person, middle, withinSecond };
  });
}
