// What movement-check does (spec Part 2 §12.5; ROADMAP 52a): runs a movement over every video of MOVEMENT_VIDEOS, sets
// the movement's numbers from the videos that may set them, and builds the proof table: each video's reps by eye
// against the engine's count, each person's count with their own videos left out of the numbers, and every other
// movement's count, which must be 0.
//
// The rules that set the numbers, in words Kd can read. First every dip of the people the numbers are set from is found
// and read with no bound at all (only the drop that starts one, half of `MEASURING_DEPTH`), and of each video's dips
// the deepest, as many as a person counted by eye, are its reps (those the camera could not judge then left out, never
// replaced by a smaller dip); then, for each rule:
//   - a "count" rule (how far the rep goes) is placed a quarter of the way back towards standing from the shallowest
//     rep any of those people did: counting is a little forgiving (§12.1, principle 4);
//   - a "match" rule (what kind of movement) is placed beyond the furthest rep any of those people did, by half of how
//     far that rep lay from the middle rep: a body never seen is given room, and every other movement is still far
//     outside;
// "standing" is the rule's own reading while the person stood ready (0 for a drop).
// Each video is played with its first picture held for a second before it, and its last picture for a second after it:
// the engine learns a body in its first half second, a live set starts with the person already in view (they walked
// back from the phone), and they are still in view after their last rep. A video that starts low gets no rep for that
// first rise, held or not; one that ends mid-air ends with the feet up. Then the set is finished.
// Each number is rounded the forgiving way, to a whole degree, a hundredth of a leg or a metre, or a twentieth of a
// second. A person's videos are left out together: the numbers are set from all the people but one and tried on that
// one, in turn.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Movement, MovementFrame, MovementRule } from "@app/shared";
import { MovementMatcher, parseMovement, type RepResult } from "../src/index.js";
import { readKept, videoOf, type Video } from "./bodyCheck.js";
import { runOf } from "./measureCheck.js";
import { MOVEMENT_VIDEOS, type MovementVideo } from "./movementVideos.js";

const TEST = join(import.meta.dirname, "../test");
export const MOVEMENTS = join(import.meta.dirname, "../movements");

/** While the reps are found to set the numbers from, a rep starts at half of this drop, in legs: about 7 cm. */
export const MEASURING_DEPTH = 0.15;
/** A count rule is placed this share of the shallowest rep's way from standing. */
export const COUNT_SHARE = 0.75;
/** A match rule is placed beyond the furthest rep by this share of its distance from the middle rep. */
export const MATCH_SHARE = 0.5;
/** Each video's first picture is held this long before it, and its last this long after it, ms. */
export const LEAD_IN = 1000;

export function readMovement(name: string): Movement {
  return parseMovement(JSON.parse(readFileSync(join(MOVEMENTS, `${name}.json`), "utf8")));
}

export interface ProofVideo {
  readonly entry: MovementVideo;
  readonly video: Video;
}

/** Reads every listed file. A video sets numbers only when bodyCheck's `videoOf` agrees: its look names this very file,
 *  every frame holds one body whose size can be read, and the plain sign of a changed body finds nothing. */
export function proofVideos(entries: readonly MovementVideo[] = MOVEMENT_VIDEOS): ProofVideo[] {
  return entries.map((entry) => {
    const file = readKept(new Uint8Array(readFileSync(join(TEST, `${entry.file}.bodypoints`))));
    const label = file.header.label;
    const seen = entry.sets && entry.sha256 !== undefined ? { [label]: { sets: true, sha256: entry.sha256, seen: entry.seen } } : {};
    return { entry, video: videoOf(file, seen) };
  });
}

export interface Run {
  readonly count: number;
  readonly reps: readonly RepResult[];
}

/** The video with its first picture held for `LEAD_IN` before it and its last for as long after, every time carried on. */
const held = new WeakMap<readonly MovementFrame[], Video>();
export function withLeadIn(video: Video): Video {
  const known = held.get(video.frames);
  if (known !== undefined) return known;
  const first = video.frames[0];
  const second = video.frames[1];
  if (first === undefined || second === undefined) return video;
  const step = second.t - first.t;
  const n = Math.round(LEAD_IN / step);
  const lead = Array.from({ length: n }, (_, k): MovementFrame => ({ ...first, t: first.t + k * step }));
  const body = video.frames.map((f) => ({ ...f, t: f.t + n * step }));
  const end = body[body.length - 1];
  const tail = end === undefined ? [] : Array.from({ length: n }, (_, k): MovementFrame => ({ ...end, t: end.t + (k + 1) * step }));
  const frames = [...lead, ...body, ...tail];
  const out = { ...video, frames };
  held.set(video.frames, out);
  return out;
}

export function runMovement(movement: Movement, video: Video): Run {
  const { steady, measured } = runOf(withLeadIn(video));
  const matcher = new MovementMatcher(movement);
  const reps: RepResult[] = [];
  let count = 0;
  steady.forEach((body, i) => {
    const m = measured[i];
    if (m === undefined) return;
    const frame = matcher.next(body, m);
    count = frame.count;
    if (frame.rep !== null) reps.push(frame.rep);
  });
  const last = matcher.finish();
  if (last !== null) {
    count = last.count;
    if (last.rep !== null) reps.push(last.rep);
  }
  return { count, reps };
}

/** The movement with no bound but the drop that starts a rep: every rep is read, none judged. */
export function measuringMovement(movement: Movement): Movement {
  return {
    ...movement,
    rules: movement.rules.map((r): MovementRule => {
      if (r.read.kind === "drop" && r.role === "count") return { ...r, atLeast: MEASURING_DEPTH };
      return r.atLeast !== undefined ? { ...r, atLeast: Number.NEGATIVE_INFINITY } : { ...r, atMost: Number.POSITIVE_INFINITY };
    }),
  };
}

export interface RuleSeen {
  readonly rule: string;
  /** Every rep's reading, and the middle of the readings while standing ready. */
  readonly reps: readonly number[];
  readonly standing: number;
}

/** The reps a person counted in the videos given, read by every rule: in each video, of the dips the measuring run
 *  found, the deepest, as many as were counted by eye (a smaller dip is a sway, not a rep). Dips the camera could not
 *  judge are left out. */
export function repsOf(movement: Movement, videos: readonly ProofVideo[]): RepResult[] {
  const measuring = measuringMovement(movement);
  const depthRule = movement.rules.find((r) => r.read.kind === "drop" && r.role === "count");
  const depthOf = (r: RepResult): number => (depthRule === undefined ? 0 : (r.readings[depthRule.name] ?? 0));
  return videos.flatMap((v) => {
    // The deepest dips first, as many as were counted, and only then those the camera could not judge left out: a rep
    // that could not be judged is never replaced by a smaller dip.
    const dips = runMovement(measuring, v.video).reps;
    const deepest = [...dips].sort((a, b) => depthOf(b) - depthOf(a)).slice(0, v.entry.reps ?? 0);
    return dips.filter((r) => deepest.includes(r) && r.verdict !== "unseen");
  });
}

function middle(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function step(rule: MovementRule): number {
  switch (rule.read.kind) {
    case "time":
      return 0.05;
    case "value":
    case "gap":
    case "apart":
      return 1;
    default:
      return 0.01;
  }
}

/** Rounded the forgiving way: further from what the rule asks. */
function rounded(value: number, size: number, up: boolean): number {
  const n = up ? Math.ceil(value / size - 1e-9) : Math.floor(value / size + 1e-9);
  return Math.round(n * size * 1e6) / 1e6;
}

export interface Fitted {
  readonly rule: string;
  readonly bound: number;
  /** The rep reading the bound was placed from, the readings while standing, and how many reps. */
  readonly from: number;
  readonly standing: number;
  readonly reps: number;
}

/** Sets every rule's number from the reps of the videos given, by the two rules above. */
export function fit(movement: Movement, videos: readonly ProofVideo[]): Fitted[] {
  const reps = repsOf(movement, videos);
  return movement.rules.map((rule) => {
    const values = reps.flatMap((r) => {
      const v = r.readings[rule.name] ?? null;
      return v === null ? [] : [v];
    });
    const standing = middle(reps.flatMap((r) => {
      const v = r.standing[rule.name] ?? null;
      return v === null ? [] : [v];
    }));
    if (values.length === 0) throw new Error(`No rep of ${movement.name} read "${rule.name}": nothing to set it from.`);
    const atLeast = rule.atLeast !== undefined;
    // The rep furthest the way the rule refuses: for a count rule the shallowest, for a match rule the furthest out.
    const extreme = atLeast ? Math.min(...values) : Math.max(...values);
    const raw = rule.role === "count" ? standing + COUNT_SHARE * (extreme - standing) : extreme + MATCH_SHARE * (extreme - middle(values));
    return { rule: rule.name, bound: rounded(raw, step(rule), !atLeast), from: extreme, standing, reps: values.length };
  });
}

export function withNumbers(movement: Movement, fitted: readonly Fitted[]): Movement {
  return {
    ...movement,
    rules: movement.rules.map((r) => {
      const f = fitted.find((x) => x.rule === r.name);
      if (f === undefined) return r;
      return r.atLeast !== undefined ? { ...r, atLeast: f.bound } : { ...r, atMost: f.bound };
    }),
  };
}

export interface ProofRow {
  readonly label: string;
  readonly entry: MovementVideo;
  readonly sets: boolean;
  /** With the numbers set from every person who may set them. */
  readonly count: number;
  /** With the numbers set from everybody but this video's person: for a video that sets numbers. */
  readonly leftOut: number | null;
  readonly reps: readonly RepResult[];
}

/** The proof table of one movement: every listed video, with the movement's own numbers, and each video that sets
 *  numbers also with its person left out. Other movements are run with every fold's numbers too: `worstOther` is the
 *  most any of those numbers counted on any other movement's video. */
export function proofTable(movement: Movement, videos: readonly ProofVideo[] = proofVideos()): {
  readonly rows: readonly ProofRow[];
  readonly fitted: readonly Fitted[];
  readonly folds: readonly { readonly person: string; readonly fitted: readonly Fitted[] }[];
  readonly worstOther: number;
} {
  const own = videos.filter((v) => v.entry.movement === movement.name);
  const setting = own.filter((v) => v.video.sets);
  const fitted = fit(movement, setting);
  const full = withNumbers(movement, fitted);
  const people = [...new Set(setting.map((v) => v.entry.person))];
  const folds = people.map((person) => ({ person, fitted: fit(movement, setting.filter((v) => v.entry.person !== person)) }));
  // A known open case is left out of the worst count, and kept in the table, in plain sight.
  const others = videos.filter((v) => v.entry.movement === null && v.entry.open === undefined);
  let worstOther = 0;
  for (const fold of folds) {
    const m = withNumbers(movement, fold.fitted);
    for (const v of others) worstOther = Math.max(worstOther, runMovement(m, v.video).count);
  }
  const rows = videos.map((v): ProofRow => {
    const run = runMovement(full, v.video);
    const fold = v.video.sets ? folds.find((f) => f.person === v.entry.person) : undefined;
    const leftOut = fold === undefined ? null : runMovement(withNumbers(movement, fold.fitted), v.video).count;
    return { label: v.video.label, entry: v.entry, sets: v.video.sets, count: run.count, leftOut, reps: run.reps };
  });
  return { rows, fitted, folds, worstOther };
}
