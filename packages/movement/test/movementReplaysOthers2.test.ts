// The worst thing (ROADMAP 52a-ii-a), the second half of the replays that must hold: every other movement counts 0 and
// is given no word. movementReplaysOthers1.test.ts holds the first half.
import { describe, expect, it } from "vitest";
import { openRow } from "../scripts/movementCheck.js";
import { HELD, VIDEOS, rowsOf } from "./helpers/replays.js";

const REPLAYS = HELD.slice(7);
const ROWS = rowsOf(REPLAYS, "other");

describe("the worst thing: no other movement is counted as a squat however the world changes it (second half)", () => {
  it("tries every other movement under each replay, the paces too", () => {
    expect(REPLAYS.map((r) => r.name)).toEqual(["shaky", "chip's gap", "passer-by", "passer-by at the bottom", "faster", "slower", "twice as slow"]);
    expect(ROWS.length).toBeGreaterThanOrEqual(30 * REPLAYS.length);
  });

  it("the passer-by acts on every other movement too: in each video it hides points it saw", () => {
    const others = VIDEOS.filter((v) => v.entry.movement === null && v.entry.reps !== null && v.entry.open === undefined);
    expect(others.length).toBeGreaterThanOrEqual(30);
    for (const replay of HELD.filter((r) => r.name.startsWith("passer-by"))) {
      for (const v of others) {
        const out = replay.edit(v.video.frames, 1, []);
        const hid = out.some((f, i) => (f.people[0]?.points ?? []).some((q, k) => q[3] < 0.5 && (v.video.frames[i]?.people[0]?.points[k]?.[3] ?? 0) >= 0.5));
        expect([replay.name, v.video.label, hid]).toEqual([replay.name, v.video.label, true]);
      }
    }
  });

  it.each(ROWS.filter((r) => r.tried && !openRow(r)).map((r) => [`${r.replay.name}: ${r.label}`, r] as const))("%s counts 0 and says nothing", (_name, r) => {
    expect(r.count).toBe(0);
    expect(r.reps.filter((x) => x.verdict === "short").length).toBe(0);
  });

  it("the rows open today are listed here, each with the job that closes it, and say nothing", () => {
    const open = ROWS.filter(openRow);
    expect(open.map((r) => `${r.replay.name}: ${r.label}`)).toEqual([
      "passer-by at the bottom: usual_v08",
      "slower: squat_jack_2",
      "twice as slow: squat_jack_2",
    ]);
    for (const r of open) expect(r.reps.filter((x) => x.verdict === "short").length).toBe(0);
    // Each counts what its entry says it does, and no more: the sit-and-stand one rep, the slowed squat jack two.
    expect(open.map((r) => r.count)).toEqual([1, 2, 2]);
  });
});
