// The L-sit's clock (ROADMAP 52c-ii) under every replay that must hold (scripts/replays.ts): its videos are timed as the
// pictures show them held (stretched when done slower or faster, less what a passer-by hides), within a quarter of a second,
// and every other video Kd's folders hold is timed 0. About seven minutes: one of the proof files (vitest.config.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { holdHolds, holdReplayTable, readHold, type HoldReplayRow } from "../scripts/holdCheck.js";
import { proofVideos } from "../scripts/movementCheck.js";
import { isOther } from "../scripts/movementVideos.js";
import { HELD } from "./helpers/floorWorkReplays.js";

describe("the L-sit's clock, under every held replay", () => {
  const hold = readHold("l-sit");
  let rows: HoldReplayRow[] = [];
  beforeAll(() => {
    rows = holdReplayTable(hold, proofVideos(), HELD).filter((r) => r.tried);
  }, 1_200_000);

  it("every held replay is tried on its videos and on every other movement's", () => {
    expect(new Set(rows.map((r) => r.replay.name))).toEqual(new Set(HELD.map((r) => r.name)));
    expect(rows.filter((r) => r.entry.movement === hold.name).length).toBe(HELD.length * 2);
  });

  it("each L-sit is timed as the pictures show it held (stretched when done slower or faster, less what a passer-by hides), within a quarter of a second", () => {
    expect(rows.filter((r) => r.entry.movement === hold.name && !holdHolds(r)).map((r) => [r.replay.name, r.label, r.heldMs, r.least, r.most])).toEqual([]);
  });

  it("every other movement is timed 0", () => {
    expect(rows.filter((r) => isOther(r.entry, hold.name) && r.heldMs !== 0).map((r) => [r.replay.name, r.label, r.heldMs])).toEqual([]);
  });
});
