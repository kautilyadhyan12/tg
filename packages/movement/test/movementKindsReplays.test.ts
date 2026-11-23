// The squat jump and the lunge (ROADMAP 52c-i) under every replay that must hold (scripts/replays.ts): nearer, farther,
// tilted, fewer and uneven pictures, shaky points, the phone's own chip gap, a passer-by, the reps done faster or slower.
// Their own videos count what a person counts by eye (the fewest a passer-by leaves), with every person's numbers and with
// their own left out; every other movement Kd's folders hold counts 0 and is told nothing; every lunge counted is given
// the leg the pictures show in front. A few minutes and about 2 GB: one of the proof files (vitest.config.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { holds, openRow, proofVideos, readMovement, replayTable, type ReplayRow } from "../scripts/movementCheck.js";
import { isOther } from "../scripts/movementVideos.js";
import { REPLAYS } from "../scripts/replays.js";

const HELD = REPLAYS.filter((r) => r.hold);
const VIDEOS = proofVideos();

describe.each([readMovement("squat-jump"), readMovement("lunge")])("$name, under every held replay", (movement) => {
  // Worked out when this movement's tests run, so each can be run alone (`-t`): each table takes about 8 minutes.
  let rows: ReplayRow[] = [];
  beforeAll(() => {
    rows = replayTable(movement, VIDEOS, HELD).filter((r) => r.tried);
  }, 1_200_000);

  it("every held replay is tried on its own videos and on the other movements'", () => {
    expect(new Set(rows.map((r) => r.replay.name))).toEqual(new Set(HELD.map((r) => r.name)));
    expect(rows.filter((r) => r.entry.movement === movement.name).length).toBeGreaterThanOrEqual(HELD.length * 4);
  });

  it("its own videos hold, but the cases written on them", () => {
    const wrong = rows.filter((r) => r.entry.movement === movement.name && !holds(r) && !openRow(r)).map((r) => [r.replay.name, r.label, r.count, r.leftOut]);
    expect(wrong).toEqual([]);
  });

  it("every other movement counts 0 and is told nothing", () => {
    const others = rows.filter((r) => isOther(r.entry, movement.name));
    expect(others.filter((r) => r.count !== 0).map((r) => [r.replay.name, r.label, r.count])).toEqual([]);
    expect(others.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.replay.name, r.label, x.reason]))).toEqual([]);
  });

  it("where it counts every lunge, each is given the leg the pictures show in front", () => {
    const sided = rows.filter((r) => r.entry.sides !== undefined && r.count === r.entry.sides.length);
    for (const r of sided) {
      expect([r.replay.name, r.label, r.reps.filter((x) => x.verdict === "counted").map((x) => x.side)]).toEqual([r.replay.name, r.label, r.entry.sides]);
    }
    // Where a replay counts fewer, every lunge it counts is still given a leg of the video's own.
    for (const r of rows.filter((x) => x.entry.sides !== undefined)) {
      for (const x of r.reps.filter((y) => y.verdict === "counted")) expect(r.entry.sides).toContain(x.side);
    }
  });
});
