// The replay table, worked out once a test file, for the replays it names (scripts/replays.ts). The whole table is
// about 700 runs, so the other movements' rows are split over two files that run side by side.
import { proofVideos, readMovement, replayTable, type ReplayRow } from "../../scripts/movementCheck.js";
import { REPLAYS, type Replay } from "../../scripts/replays.js";

export const SQUAT = readMovement("squat");
export const VIDEOS = proofVideos();
export const HELD: readonly Replay[] = REPLAYS.filter((r) => r.hold);

/** The rows of the judged videos `which` picks, under `replays`. */
export function rowsOf(replays: readonly Replay[], which: "squat" | "other"): ReplayRow[] {
  const videos = VIDEOS.filter((v) => (which === "squat" ? v.entry.movement === "squat" : v.entry.movement === null));
  return replayTable(SQUAT, videos, replays);
}
