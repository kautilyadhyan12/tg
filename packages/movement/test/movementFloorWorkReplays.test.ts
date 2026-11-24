// Floor work and the hold (ROADMAP 52c-ii) under every replay that must hold (scripts/replays.ts): nearer, farther, tilted,
// fewer and uneven pictures, shaky points, the phone's own chip gap, a passer-by, the movement done faster or slower. The
// sit-up's and the hip thrust's own videos count what a person counts by eye (the fewest a passer-by leaves), with every
// person's numbers and with their own left out, but the cases written on them; every other movement Kd's folders hold
// counts 0 and is told nothing. The L-sit's clock gives its videos the time the pictures show, and every other video
// none. Several minutes and about 2 GB: one of the proof files (vitest.config.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { holdHolds, holdReplayTable, readHold, type HoldReplayRow } from "../scripts/holdCheck.js";
import { holds, openRow, proofVideos, readMovement, replayTable, type ReplayRow } from "../scripts/movementCheck.js";
import { isOther } from "../scripts/movementVideos.js";
import { REPLAYS } from "../scripts/replays.js";

const HELD = REPLAYS.filter((r) => r.hold);
const VIDEOS = proofVideos();

describe.each([readMovement("sit-up"), readMovement("hip-thrust")])("$name, under every held replay", (movement) => {
  let rows: ReplayRow[] = [];
  beforeAll(() => {
    rows = replayTable(movement, VIDEOS, HELD).filter((r) => r.tried);
  }, 1_200_000);

  it("every held replay is tried on its own videos and on the other movements'", () => {
    expect(new Set(rows.map((r) => r.replay.name))).toEqual(new Set(HELD.map((r) => r.name)));
    expect(rows.filter((r) => r.entry.movement === movement.name).length).toBeGreaterThanOrEqual(HELD.length * 2);
    expect(rows.filter((r) => isOther(r.entry, movement.name)).length).toBeGreaterThanOrEqual(HELD.length * 100);
  });

  it("its own videos hold, but the cases written on them, and a written case never counts more than by eye", () => {
    const wrong = rows.filter((r) => r.entry.movement === movement.name && !holds(r) && !openRow(r)).map((r) => [r.replay.name, r.label, r.count, r.leftOut]);
    expect(wrong).toEqual([]);
    // Round one: a written replay case is fewer reps, never an extra one.
    const more = rows.filter((r) => r.entry.movement === movement.name && openRow(r) && (r.count > r.most || (r.leftOut ?? 0) > r.most)).map((r) => [r.replay.name, r.label, r.count, r.leftOut]);
    expect(more).toEqual([]);
  });

  it("every other movement counts 0 and is told nothing", () => {
    const others = rows.filter((r) => isOther(r.entry, movement.name));
    expect(others.filter((r) => r.count !== 0).map((r) => [r.replay.name, r.label, r.count])).toEqual([]);
    expect(others.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.replay.name, r.label, x.reason]))).toEqual([]);
  });
});

describe("the L-sit's clock, under every held replay", () => {
  const hold = readHold("l-sit");
  let rows: HoldReplayRow[] = [];
  beforeAll(() => {
    rows = holdReplayTable(hold, VIDEOS, HELD).filter((r) => r.tried);
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
