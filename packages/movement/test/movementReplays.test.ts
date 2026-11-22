// Each squat video played again the ways the world changes it (ROADMAP 52a-ii-a; spec Part 2 §12.5). The worst thing
// first: a jump is still not a squat when the phone is nearer, farther, tilted, shaky, reads the points as its own chip
// does, or somebody walks past. Then each squat video counts what a person counts by eye under every replay that must
// hold, with its person left out of the numbers too, and a passer-by hides at most the rep it covers, never counts it.
import { describe, expect, it } from "vitest";
import { asReplayed, holds, openRow, replayed, type ProofVideo } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";
import { HELD, SQUAT, VIDEOS, rowsOf } from "./helpers/replays.js";
import { trueHop } from "./helpers/hops.js";

const ROWS = rowsOf(HELD, "squat");
const proofOf = (label: string): ProofVideo => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v;
};
const replay = (name: string) => {
  const r = REPLAYS.find((x) => x.name === name);
  if (r === undefined) throw new Error(`no replay ${name}`);
  return r;
};

describe("the worst thing: a jump is not a squat under any replay that must hold", () => {
  // Five reps with no pause between them, a 10 cm jump true to gravity at three take-off times round each rep's top.
  // The phone's ways of seeing pictures are in movementHops.test.ts; here every other replay, each with three seeds.
  const base = proofOf("prisoner_squat_3");
  const NAMES = ["nearer", "farther", "tilted left", "tilted right", "shaky", "chip's gap", "passer-by"];

  it.each(NAMES)("under %s: 0", (name) => {
    for (const offset of [-100, 0, 100]) {
      const jumped: ProofVideo = { entry: base.entry, video: trueHop(base.video, 0.1, offset) };
      for (const seed of ["", " again", " once more"]) {
        const r = replayed(SQUAT, { ...jumped, video: { ...jumped.video, label: `${jumped.video.label}${seed}` } }, replay(name));
        expect([offset, seed, r.count]).toEqual([offset, seed, 0]);
      }
    }
  });
});

describe("each squat video counts what a person counts by eye, however the world changes it", () => {
  it("every squat video with a count by eye is tried under every replay that must hold", () => {
    expect(HELD.map((r) => r.name)).toEqual([
      "nearer",
      "farther",
      "tilted left",
      "tilted right",
      "15 a second",
      "8 a second",
      "uneven",
      "shaky",
      "chip's gap",
      "passer-by",
      "passer-by at the bottom",
      "faster",
      "slower",
      "twice as slow",
    ]);
    // The 13 squat videos with a count by eye, and a man's own ten sets from a phone on the floor and raised (52a-ii-b-i;
    // his dull-floor set cut in two where he turns round, 52a-ii-b-ii-b-ii).
    expect(new Set(ROWS.map((r) => r.label)).size).toBe(23);
  });

  it.each(ROWS.filter((r) => r.tried && !openRow(r)).map((r) => [`${r.replay.name}: ${r.label}`, r] as const))("%s, with the squat's numbers and, where the video sets them, with its person left out", (_name, r) => {
    expect([r.count, r.leftOut, holds(r)]).toEqual([r.count, r.leftOut, true]);
  });

  it("every video that sets numbers is judged under every replay with its person left out too", () => {
    expect(ROWS.filter((r) => r.entry.sets).every((r) => r.leftOut !== null)).toBe(true);
  });

  it("a replay that changed nothing is not counted as tried, and nearer still tries most squat videos", () => {
    const nearer = ROWS.filter((r) => r.replay.name === "nearer");
    expect(nearer.filter((r) => r.tried).length).toBeGreaterThanOrEqual(10);
    expect(ROWS.filter((r) => r.replay.name !== "nearer").every((r) => r.tried)).toBe(true);
  });

  it("the rows open today are listed here, each with the job that closes it; each is right as filmed", () => {
    expect(ROWS.filter(openRow).map((r) => `${r.label}: ${r.replay.name}`)).toEqual([
      "floor_phone_test 0-12 s: 8 a second",
      "floor_phone_test 0-12 s: uneven",
      "fresh_goblet_squat_plate: uneven",
      "floor_phone_test 0-12 s: shaky",
      "usual_v11 30-39 s: shaky",
      "floor_phone_test 0-12 s: chip's gap",
      "usual_v11 30-39 s: chip's gap",
      "floor_phone_test 0-12 s: faster",
      "floor_phone_test 13.9-21.1 s: slower",
      "usual_v11 30-39 s: slower",
      "prisoner_squat_2: twice as slow",
      "floor_phone_test 13.9-21.1 s: twice as slow",
    ]);
    expect(ROWS.filter(openRow).every((r) => /^(52b-i|53), /.test(r.entry.replayOpen?.why ?? ""))).toBe(true);
    // An open row only ever misses squats: never one more than by eye, with every person's numbers or with its own left out.
    expect(ROWS.filter(openRow).filter((r) => r.count > r.most || (r.leftOut ?? 0) > r.most).map((r) => `${r.label}: ${r.replay.name}`)).toEqual([]);
  });

  it.each(["passer-by", "passer-by at the bottom"])("%s hides at most the rep it covers: that rep decides nothing and is never called short", (name) => {
    const rows = ROWS.filter((r) => r.replay.name === name);
    for (const r of rows) {
      expect([r.label, r.count >= r.most - 1 && r.count <= r.most]).toEqual([r.label, true]);
      expect([r.label, r.reps.filter((x) => x.verdict === "short").length]).toEqual([r.label, 0]);
    }
    if (name === "passer-by at the bottom") expect(rows.filter((r) => r.count < r.most).length).toBeGreaterThan(0);
  });
});

describe("the numbers are set from the eight people as filmed and as each replay that changes only how the camera reads a body", () => {
  it("every replay that sets numbers changes the camera, never the person: no passer-by, nothing only shown", () => {
    expect(REPLAYS.filter((r) => r.fits).map((r) => r.name)).toEqual(["nearer", "farther", "tilted left", "tilted right", "15 a second", "8 a second", "uneven", "shaky", "chip's gap"]);
    expect(REPLAYS.filter((r) => r.fits).every((r) => r.hold && r.hides === undefined)).toBe(true);
  });

  it("a video is replayed once for the numbers, the same frames each time it is asked for", () => {
    const v = proofOf("squat_reference");
    expect(asReplayed(v)).toBe(asReplayed(v));
    expect(asReplayed(v).length).toBe(9);
    expect(asReplayed(v).every((r) => r.entry === v.entry)).toBe(true);
  });
});
