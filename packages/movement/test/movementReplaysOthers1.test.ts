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

  it.each(ROWS.filter((r) => r.tried && !openRow(r)).map((r) => [`${r.replay.name}: ${r.label}`, r] as const))("%s counts 0, is never told to go lower or to keep the chest up, and says only what the camera could not see", (_name, r) => {
    expect(r.count).toBe(0);
    // The worst thing of 52b-ii-b: another movement's dip told "Keep your chest up." (the squat's camera file rides along).
    expect(r.reps.filter((x) => x.verdict === "refused").map((x) => x.reason)).toEqual([]);
    // The push press's dips, a quarter squat to the camera, are told to go lower as a quarter squat is (its video says so).
    if (r.entry.told === undefined) expect(r.reps.filter((x) => x.verdict === "short").length).toBe(0);
    else expect([...new Set(r.reps.filter((x) => x.verdict === "short").map((x) => x.reason))]).toEqual(["Go lower to count."]);
    // Round one: a dip the camera could not judge says what it could not see; whatever else another movement does says
    // nothing (13 dips of 6 videos under all the held replays speak so, none as filmed: movementMatcher.test.ts).
    const spoken = r.reps.filter((x) => x.reason !== null && !(r.entry.told !== undefined && x.verdict === "short"));
    expect(spoken.map((x) => [x.verdict, x.reason])).toEqual(spoken.map(() => ["unseen", "Keep your whole body in view."]));
  });

  it("the rows open today are listed here, each with the job that closes it, and say nothing", () => {
    const open = ROWS.filter(openRow);
    expect(open.map((r) => `${r.replay.name}: ${r.label}`)).toEqual([]);
    for (const r of open) expect(r.reps.filter((x) => x.verdict === "short" || x.verdict === "refused").length).toBe(0);
  });
});
