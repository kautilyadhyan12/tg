// The worst thing (ROADMAP 52a-ii-a), the second half of the replays that must hold: every other movement counts 0 and
// is given no word. movementReplaysOthers1.test.ts holds the first half.
import { describe, expect, it } from "vitest";
import { openRow, readExercise, readMovement } from "../scripts/movementCheck.js";
import { saidOf, speaking } from "../scripts/coachCheck.js";
import { HELD, VIDEOS, rowsOf } from "./helpers/replays.js";

const REPLAYS = HELD.slice(7);
const ROWS = rowsOf(REPLAYS, "other");
/** The squat's camera file with every mistake it checks spoken (53b-i): the coach's worst case. */
const LOUD = speaking(readExercise("squat"), readMovement("squat"));

describe("the worst thing: no other movement is counted as a squat however the world changes it (second half)", () => {
  it("tries every other movement under each replay, the paces too", () => {
    expect(REPLAYS.map((r) => r.name)).toEqual(["shaky", "chip's gap", "passer-by", "passer-by at the bottom", "faster", "slower", "twice as slow"]);
    expect(ROWS.length).toBeGreaterThanOrEqual(30 * REPLAYS.length);
  });

  it("the passer-by acts on every other movement too: in each video it hides points it saw", () => {
    const others = VIDEOS.filter((v) => v.entry.movement !== "squat" && v.entry.reps !== null && v.entry.open === undefined);
    expect(others.length).toBeGreaterThanOrEqual(30);
    for (const replay of HELD.filter((r) => r.name.startsWith("passer-by"))) {
      for (const v of others) {
        const out = replay.edit(v.video.frames, 1, []);
        const hid = out.some((f, i) => (f.people[0]?.points ?? []).some((q, k) => q[3] < 0.5 && (v.video.frames[i]?.people[0]?.points[k]?.[3] ?? 0) >= 0.5));
        expect([replay.name, v.video.label, hid]).toEqual([replay.name, v.video.label, true]);
      }
    }
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
    // 53b-i: the coach says no more than the screen does, never a correction, praise or the count, every mistake spoken.
    const said = saidOf(r.reps, LOUD);
    expect(said.filter((s) => s.kind !== "reason").map((s) => s.words)).toEqual([]);
    expect(said.filter((s) => s.words !== "Keep your whole body in view." && !(r.entry.told !== undefined && s.words === "Go lower to count.")).map((s) => s.words)).toEqual([]);
  });

  it("the rows open today are listed here, each with the job that closes it, and say nothing", () => {
    const open = ROWS.filter(openRow);
    expect(open.map((r) => `${r.replay.name}: ${r.label}`)).toEqual(["slower: squat_jack_2", "twice as slow: squat_jack_2"]);
    for (const r of open) expect(r.reps.filter((x) => x.verdict === "short" || x.verdict === "refused").length).toBe(0);
    // Each counts what its entry says it does, and no more: the slowed squat jack two at 1.5 times as slowly and one at twice. His
    // sit-and-stand on a chair (usual_v08), open under every replay since 52d-i, is out of this table: onePerson.test.ts.
    expect(open.map((r) => r.count)).toEqual([2, 1]);
  });
});
