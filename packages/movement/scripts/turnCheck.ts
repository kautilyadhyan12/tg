// The turn's number (ROADMAP 52d-ii, src/movement/matcher.ts `MatchLimits.turned`, src/body/facing.ts): between reps, how
// far from the way they faced when their standing was taken a person faces, on every proof set the camera counts.
//
// The rule, in words Kd can read. For each movement counted by reps, each of its own videos it counts (its twins' among
// them; never another movement's video it counts by mistake, an open case: his sit-and-stand on a chair turns the chair
// round between two sits), as filmed and as each replay that must hold, with no turn ever replacing the standing: from the
// set's first counted rep to the last rep it told the person about (counted, short, unseen or refused), at every picture
// between reps, how far the way the person faces lies from the way they faced when their standing was taken. Each set
// gives its furthest. The bound is beyond the furthest set by half its distance from the middle set, as the lock's numbers
// are (lockCheck.ts), rounded up to 5 degrees: a person facing further than that from their standing has turned.
//
// Before the first counted rep is not read: a person getting to their place turns on purpose (walking back from the phone
// and turning side on), and a standing found facing the new way is wanted there. That it costs no rep there is held by the
// walk-back proof (movementWalkBack.test.ts: his sets begun at every picture of his walk back count every squat; round
// one's H1, when the standing was forgotten at the turn instead of replaced, lost one from six of them).
import type { Movement } from "@app/shared";
import { MATCH_LIMITS, MovementMatcher, type MatchLimits } from "../src/index.js";
import type { Video } from "./bodyCheck.js";
import { readMovementFile } from "./holdCheck.js";
import { LOCKED_MOVEMENTS, LOCK_REPLAYS } from "./lockCheck.js";
import { runOf } from "./measureCheck.js";
import { countedTimes, proofVideos, readExercise, seedOf, withLeadIn, type ProofVideo } from "./movementCheck.js";
import type { Replay } from "./replays.js";

/** The matcher with no turn ever replacing a standing: what a set's own facing does between its reps. */
export const NEVER_TURNED: MatchLimits = { ...MATCH_LIMITS, turned: Number.POSITIVE_INFINITY };

export interface TurnRow {
  readonly movement: string;
  readonly label: string;
  /** The replay, or "as filmed". */
  readonly replay: string;
  /** The furthest, degrees, between the first counted rep and the last rep told; and the pictures it was read in. */
  readonly turned: number;
  readonly pictures: number;
}

/** One set's row; null when it never counted. */
export function turnRow(movement: Movement, video: Video, replay: string, limits: MatchLimits = NEVER_TURNED): TurnRow | null {
  const lead = withLeadIn(video);
  const { steady, measured } = runOf(lead);
  const matcher = new MovementMatcher(movement, limits, movement.name === "squat" ? readExercise("squat", movement) : null);
  const frames = steady.flatMap((s, i) => {
    const m = measured[i];
    return m === undefined ? [] : [matcher.next(s, m)];
  });
  const last = matcher.finish();
  const reps = [...frames.flatMap((f) => (f.rep === null ? [] : [f.rep])), ...(last?.rep === null || last === null ? [] : [last.rep])];
  const first = reps.find((r) => r.verdict === "counted");
  const told = reps.filter((r) => r.verdict !== "other");
  const end = told[told.length - 1]?.end;
  if (first === undefined || end === undefined) return null;
  const between = frames.filter((f) => f.t >= first.end && f.t <= end && f.turned !== null);
  return { movement: movement.name, label: video.label, replay, turned: Math.max(0, ...between.map((f) => f.turned ?? 0)), pictures: between.length };
}

function replayedVideo(movement: Movement, v: ProofVideo, replay: Replay): Video {
  return { ...v.video, frames: replay.edit(v.video.frames, seedOf(v.video.label, replay.name), countedTimes(movement, v.video)) };
}

/** Every set's row, as filmed and under each replay that must hold. */
export function turnRows(videos: readonly ProofVideo[] = proofVideos(), replays: readonly Replay[] = LOCK_REPLAYS): TurnRow[] {
  return LOCKED_MOVEMENTS.flatMap((name) => {
    const file = readMovementFile(name);
    if (file.counting === "hold" || file.counting === "timed only") return [];
    return videos.flatMap((v) => {
      if (v.entry.movement !== name) return [];
      const filmed = turnRow(file, v.video, "as filmed");
      if (filmed === null) return [];
      return [filmed, ...replays.flatMap((r) => turnRow(file, replayedVideo(file, v, r), r.name) ?? [])];
    });
  });
}

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Rounded up to `step`. */
const upTo = (value: number, step: number): number => Math.round(Math.ceil(value / step - 1e-9) * step * 1e6) / 1e6;

export interface TurnNumber {
  readonly turned: number;
  readonly furthest: number;
  readonly middle: number;
  readonly sets: number;
}

/** The turn's number by the rule above. */
export function turnNumber(rows: readonly TurnRow[]): TurnNumber {
  const turned = rows.map((r) => r.turned);
  const furthest = Math.max(...turned);
  const middle = median(turned);
  return { turned: upTo(furthest + (furthest - middle) / 2, 5), furthest, middle, sets: rows.length };
}
