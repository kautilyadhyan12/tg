// What a hold's proof does (spec Part 2 §12.5; ROADMAP 52c-ii): plays a hold over every video of MOVEMENT_VIDEOS, sets
// the hold's numbers from the videos that may set them, and builds its table: each hold video's time held by eye against
// the clock's, each person's with their own videos left out of the numbers, and every other movement's time, which must
// be 0.
//
// The rule that sets the numbers, in words Kd can read: every picture the eye saw held (`held` in movementVideos.ts) is
// read by each condition of the position, in each video as filmed and as each replay that changes only how the camera
// reads a body (replays.ts `fits`); each condition is placed beyond the furthest picture any of those people held, by half
// of how far that picture lay from the middle one (the middle of each person's own middle, each person counted once), as a
// "match" rule of a movement is: what kind of position it is, strict. A person's videos are left out together: the numbers
// are set from all the people but one and tried on that one, in turn. Each video is played with its first and last
// pictures held for a second (the engine learns a body in its first half second), and only the time held inside the video's
// own clock is counted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HoldMovement, MovementFile, MovementReady } from "@app/shared";
import { HoldMatcher, parseMovementFile, readPosition, type HoldResult } from "../src/index.js";
import type { Video } from "./bodyCheck.js";
import { runOf } from "./measureCheck.js";
import { LEAD_IN, MOVEMENTS, asReplayed, seedOf, withLeadIn, type ProofVideo } from "./movementCheck.js";
import { isOther, type MovementVideo } from "./movementVideos.js";
import { REPLAYS, type Replay } from "./replays.js";

/** Any movement file, by its kind of counting. */
export function readMovementFile(name: string): MovementFile {
  return parseMovementFile(JSON.parse(readFileSync(join(MOVEMENTS, `${name}.json`), "utf8")));
}

/** A hold's file; any other kind is refused by its name. */
export function readHold(name: string): HoldMovement {
  const file = readMovementFile(name);
  if (file.counting !== "hold") throw new Error(`${name} is not a hold: it is counted "${file.counting}".`);
  return file;
}

/** The time a person holds by eye in a video, ms. */
export function heldByEye(entry: MovementVideo): number {
  return Math.round((entry.held ?? []).reduce((n, [a, b]) => n + (b - a) * 1000, 0));
}

export interface HoldRun {
  /** The time held inside the video's own clock, ms. */
  readonly heldMs: number;
  /** Each hold, in the video's own clock from its first picture, ms. */
  readonly holds: readonly HoldResult[];
}

/** How far the lead-in moves a video's clock (`withLeadIn`), ms. */
function leadOf(video: Video): number {
  const first = video.frames[0];
  const second = video.frames[1];
  if (first === undefined || second === undefined) return 0;
  const step = second.t - first.t;
  return Math.round(LEAD_IN / step) * step;
}

/** A hold over one video: only the time held inside its own clock, from its first picture to its last. */
export function runHold(hold: HoldMovement, video: Video): HoldRun {
  const { measured } = runOf(withLeadIn(video));
  const matcher = new HoldMatcher(hold);
  const found: HoldResult[] = [];
  for (const m of measured) {
    const frame = matcher.next(m);
    if (frame.hold !== null) found.push(frame.hold);
  }
  const last = matcher.finish();
  if (last?.hold) found.push(last.hold);
  const t0 = (video.frames[0]?.t ?? 0) + leadOf(video);
  const end = (video.frames[video.frames.length - 1]?.t ?? 0) + leadOf(video);
  const holds = found.flatMap((h) => {
    const a = Math.max(h.start, t0);
    const b = Math.min(h.end, end);
    return b > a ? [{ start: a - t0, end: b - t0 }] : [];
  });
  return { heldMs: holds.reduce((n, h) => n + h.end - h.start, 0), holds };
}

/** Each condition's reading in every picture the eye saw held, in the video and as each replay that sets numbers. */
function heldReadings(hold: HoldMovement, videos: readonly ProofVideo[]): number[][] {
  return hold.position.map((c) =>
    videos.flatMap((v) =>
      [v, ...asReplayed(v)].flatMap((w) => {
        const { measured } = runOf(w.video);
        const t0 = w.video.frames[0]?.t ?? 0;
        const spans = v.entry.held ?? [];
        return measured.flatMap((m) => {
          const s = (m.t - t0) / 1000;
          if (!spans.some(([a, b]) => s >= a && s <= b)) return [];
          const r = readPosition(c.read, m);
          return r === null ? [] : [r];
        });
      }),
    ),
  );
}

function middle(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** A hold's numbers: each condition beyond the furthest held picture by half its distance from the middle one. */
export interface HoldFitted {
  readonly condition: number;
  readonly bound: number;
  readonly from: number;
  readonly pictures: number;
}

export function fitHold(hold: HoldMovement, videos: readonly ProofVideo[]): HoldFitted[] {
  const all = heldReadings(hold, videos);
  const people = [...new Set(videos.map((v) => v.entry.person))].map((p) => heldReadings(hold, videos.filter((v) => v.entry.person === p)));
  return hold.position.map((c, k) => {
    const values = all[k] ?? [];
    if (values.length === 0) throw new Error(`No picture of ${hold.name} read condition ${String(k + 1)}: nothing to set it from.`);
    const atLeast = c.atLeast !== undefined;
    const extreme = atLeast ? Math.min(...values) : Math.max(...values);
    const own = people.flatMap((p) => ((p[k] ?? []).length === 0 ? [] : [middle(p[k] ?? [])]));
    const raw = extreme + 0.5 * (extreme - middle(own));
    // Towards the pictures, its room already given: what kind of position it is, strict.
    const bound = atLeast ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9);
    return { condition: k, bound, from: extreme, pictures: values.length };
  });
}

export function withHoldNumbers(hold: HoldMovement, fitted: readonly HoldFitted[]): HoldMovement {
  return {
    ...hold,
    position: hold.position.map((c, k): MovementReady => {
      const f = fitted[k];
      if (f === undefined) return c;
      return c.atLeast !== undefined ? { ...c, atLeast: f.bound } : { ...c, atMost: f.bound };
    }),
  };
}

// ── Each video replayed the ways the world changes it (replays.ts says each) ────────────────────────────────────────
/** How far a replayed hold's time may lie from what it must be, ms: a quarter of a second (at 8 pictures a second each
 *  end of a hold lies up to 125 ms from where the eye put it). */
export const HOLD_ROOM = 250;
/** How long a passer-by hides the person, ms (replays.ts `passerBy`): the time they cover is never held time. */
export const PASSER_BY = 800;

export interface HoldReplayRow {
  readonly replay: Replay;
  readonly label: string;
  readonly entry: MovementVideo;
  /** What it must be timed, ms: between these (0 and 0 for another movement). */
  readonly least: number;
  readonly most: number;
  readonly heldMs: number;
  readonly tried: boolean;
}

/** One video under one replay. A hold done faster or slower is held for that much less or more time (`Replay.pace`); a
 *  passer-by takes away the time they cover, centred on the middle of the hold. */
export function holdReplayed(hold: HoldMovement, v: ProofVideo, replay: Replay): HoldReplayRow {
  const spans = (v.entry.held ?? []).map(([a, b]) => ({ start: (v.video.frames[0]?.t ?? 0) + a * 1000, end: (v.video.frames[0]?.t ?? 0) + b * 1000 }));
  const frames = replay.edit(v.video.frames, seedOf(v.video.label, replay.name), spans);
  const run = runHold(hold, { ...v.video, frames });
  const mine = v.entry.movement === hold.name;
  const eye = mine ? heldByEye(v.entry) * (replay.pace ?? 1) : 0;
  return {
    replay,
    label: v.video.label,
    entry: v.entry,
    least: mine ? Math.max(0, eye - (replay.hides === undefined ? 0 : PASSER_BY) - HOLD_ROOM) : 0,
    most: mine ? eye + HOLD_ROOM : 0,
    heldMs: run.heldMs,
    tried: replay.tried?.(v.video.frames, v.entry) ?? true,
  };
}

export function holdReplayTable(hold: HoldMovement, videos: readonly ProofVideo[], replays: readonly Replay[] = REPLAYS): HoldReplayRow[] {
  return replays.flatMap((replay) => videos.map((v) => holdReplayed(hold, v, replay)));
}

export const holdHolds = (r: HoldReplayRow): boolean => r.heldMs >= r.least && r.heldMs <= r.most;

export interface HoldRow {
  readonly label: string;
  readonly entry: MovementVideo;
  /** With the numbers set from every person who may set them. */
  readonly heldMs: number;
  /** With the numbers set from everybody but this video's person: for a video that sets numbers. */
  readonly leftOutMs: number | null;
  readonly holds: readonly HoldResult[];
}

/** The hold's table: every video, with its own numbers, each that sets numbers also with its person left out; other
 *  movements with every fold's numbers too: `worstOther` is the most time any of those numbers gave another movement. */
export function holdTable(hold: HoldMovement, videos: readonly ProofVideo[]): {
  readonly rows: readonly HoldRow[];
  readonly fitted: readonly HoldFitted[];
  readonly folds: readonly { readonly person: string; readonly fitted: readonly HoldFitted[] }[];
  readonly worstOther: number;
} {
  const setting = videos.filter((v) => v.entry.movement === hold.name && v.video.sets);
  const fitted = fitHold(hold, setting);
  const full = withHoldNumbers(hold, fitted);
  const people = [...new Set(setting.map((v) => v.entry.person))];
  const folds = people.map((person) => ({ person, fitted: fitHold(hold, setting.filter((v) => v.entry.person !== person)) }));
  let worstOther = 0;
  for (const fold of folds) {
    const h = withHoldNumbers(hold, fold.fitted);
    for (const v of videos.filter((x) => isOther(x.entry, hold.name))) worstOther = Math.max(worstOther, runHold(h, v.video).heldMs);
  }
  const rows = videos.map((v): HoldRow => {
    const run = runHold(full, v.video);
    const fold = v.video.sets && v.entry.movement === hold.name ? folds.find((f) => f.person === v.entry.person) : undefined;
    const leftOutMs = fold === undefined ? null : runHold(withHoldNumbers(hold, fold.fitted), v.video).heldMs;
    return { label: v.video.label, entry: v.entry, heldMs: run.heldMs, leftOutMs, holds: run.holds };
  });
  return { rows, fitted, folds, worstOther };
}
