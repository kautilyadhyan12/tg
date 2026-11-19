// Each squat video played again the ways the world changes it (ROADMAP 52a-ii-a; spec Part 2 §12.5). The worst thing
// first: a hop is still not a squat when the phone is tilted, slow, skips pictures or reads the points as its own chip
// does. Then each squat video counts what a person counts by eye under every replay that must hold, the known open
// rows written here in plain sight, and a passer-by at the bottom of a rep hides that rep, never counts it.
import { describe, expect, it } from "vitest";
import { asReplayed, holds, openRow, replayed, runMovement, type ProofVideo } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";
import { HELD, SQUAT, VIDEOS, rowsOf } from "./helpers/replays.js";
import { hoppedAt, sizeOf } from "./helpers/hops.js";

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

describe("the worst thing: a hop is not a squat however the world changes it", () => {
  // Five reps with no pause between them, a 10 cm hop starting 0.2 s before each rep is back: round one's hardest hop.
  const base = proofOf("prisoner_squat_3");
  const hopped: ProofVideo = { entry: base.entry, video: hoppedAt(base.video, 0.1 * sizeOf(base.video), 200) };

  it("the hopped video counts 0 as it is", () => {
    expect(runMovement(SQUAT, hopped.video).count).toBe(0);
  });

  it.each(["tilted left", "8 a second", "uneven", "shaky", "chip's gap", "farther"])("and 0 under %s", (name) => {
    expect(replayed(SQUAT, hopped, replay(name)).count).toBe(0);
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
    ]);
    expect(new Set(ROWS.map((r) => r.label)).size).toBe(13);
  });

  it.each(ROWS.filter((r) => !openRow(r)).map((r) => [`${r.replay.name}: ${r.label}`, r] as const))("%s", (_name, r) => {
    expect([r.count, holds(r)]).toEqual([r.count, true]);
  });

  it("the known open rows stay in plain sight, each wrong count written and the job that closes it named", () => {
    const open = ROWS.filter(openRow);
    expect(open.map((r) => [r.replay.name, r.label, r.count, r.most])).toEqual([["8 a second", "fresh_goblet_squat_plate", 3, 4]]);
    expect(open.every((r) => /^52c: /.test(r.entry.replayOpen?.why ?? ""))).toBe(true);
    // A missed rep, never a false one.
    expect(open.every((r) => r.count < r.most)).toBe(true);
  });

  it("a passer-by at the bottom of a rep hides it: it decides nothing and is never called short, the other reps count", () => {
    const rows = ROWS.filter((r) => r.replay.name === "passer-by at the bottom");
    for (const r of rows) {
      expect([r.label, r.count >= r.most - 1 && r.count <= r.most]).toEqual([r.label, true]);
      expect([r.label, r.reps.filter((x) => x.verdict === "short").length]).toEqual([r.label, 0]);
    }
    expect(rows.filter((r) => r.count < r.most).length).toBeGreaterThan(0);
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
