// The worst thing (ROADMAP 52a-ii-a): a rep nobody did, counted because the world changed how the camera saw them, goes
// to a person's records and the boards. Every other movement Kd's folders hold, under each replay that must hold
// (scripts/replays.ts), counts 0 and is given no word. The first half of the replays; the second is in
// movementReplaysOthers2.test.ts.
import { describe, expect, it } from "vitest";
import { openRow } from "../scripts/movementCheck.js";
import { HELD, rowsOf } from "./helpers/replays.js";

const REPLAYS = HELD.slice(0, 7);
const ROWS = rowsOf(REPLAYS, "other");

describe("the worst thing: no other movement is counted as a squat however the world changes it (first half)", () => {
  it("tries every other movement under each replay", () => {
    expect(REPLAYS.map((r) => r.name)).toEqual(["nearer", "farther", "tilted left", "tilted right", "15 a second", "8 a second", "uneven"]);
    expect(ROWS.length).toBeGreaterThanOrEqual(30 * REPLAYS.length);
  });

  it.each(ROWS.filter((r) => r.tried && !openRow(r)).map((r) => [`${r.replay.name}: ${r.label}`, r] as const))("%s counts 0 and says nothing", (_name, r) => {
    expect(r.count).toBe(0);
    // The push press's dips, a quarter squat to the camera, are told to go lower as a quarter squat is (its video says so).
    if (r.entry.told === undefined) expect(r.reps.filter((x) => x.verdict === "short").length).toBe(0);
    else expect([...new Set(r.reps.filter((x) => x.verdict === "short").map((x) => x.reason))]).toEqual(["Go lower to count."]);
  });

  it("the rows open today are listed here, each with the job that closes it, and say nothing", () => {
    const open = ROWS.filter(openRow);
    expect(open.map((r) => `${r.replay.name}: ${r.label}`)).toEqual([]);
    for (const r of open) expect(r.reps.filter((x) => x.verdict === "short").length).toBe(0);
  });
});
