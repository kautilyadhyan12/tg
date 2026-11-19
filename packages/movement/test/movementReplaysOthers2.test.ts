// The worst thing (ROADMAP 52a-ii-a), the second half of the replays that must hold: every other movement counts 0 and
// is given no word. movementReplaysOthers1.test.ts holds the first half.
import { describe, expect, it } from "vitest";
import { HELD, rowsOf } from "./helpers/replays.js";

const REPLAYS = HELD.slice(6);
const ROWS = rowsOf(REPLAYS, "other");

describe("the worst thing: no other movement is counted as a squat however the world changes it (second half)", () => {
  it("tries every other movement under each replay", () => {
    expect(REPLAYS.map((r) => r.name)).toEqual(["uneven", "shaky", "chip's gap", "passer-by", "passer-by at the bottom"]);
    expect(ROWS.length).toBeGreaterThanOrEqual(30 * REPLAYS.length);
  });

  it.each(ROWS.map((r) => [`${r.replay.name}: ${r.label}`, r] as const))("%s counts 0 and says nothing", (_name, r) => {
    expect(r.count).toBe(0);
    expect(r.reps.filter((x) => x.verdict === "short").length).toBe(0);
  });
});
