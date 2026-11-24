// Holds and timed only (ROADMAP 52c-ii; spec Part 2 §12.3): a clock that runs only while the position is held, and a
// plain timer for what the camera cannot judge. The worst thing a hold could do to a person: time a hold nobody held, or
// keep the clock running after they let go. So the first tests are every other movement Kd's folders hold, which must be
// timed 0 under the hold, with its own numbers and with every set made with one person left out; and each real hold's
// clock stopping as the legs come down.
import { describe, expect, it } from "vitest";
import { engineSetSummarySchema, holdMovementSchema, movementFileSchema, timedMovementSchema, type ExerciseCamera, type HoldMovement } from "@app/shared";
import { HOLD_LIMITS, HoldMatcher, HoldRecord, checkHold, heldOf, parseMovementFile } from "../src/index.js";
import { runOf } from "../scripts/measureCheck.js";
import { HOLD_ROOM, heldByEye, holdHolds, holdReplayTable, holdTable, readHold, readMovementFile, runHold } from "../scripts/holdCheck.js";
import { proofVideos } from "../scripts/movementCheck.js";
import { forMovement, isOther } from "../scripts/movementVideos.js";
import { REPLAYS } from "../scripts/replays.js";

const L_SIT = readHold("l-sit");
const VIDEOS = proofVideos();
const TABLE = holdTable(L_SIT, VIDEOS);

describe("the worst thing: no other movement is timed as an L-sit, and its clock stops when the legs come down", () => {
  const others = TABLE.rows.filter((r) => isOther(r.entry, L_SIT.name));

  it("every movement Kd's folders hold but this one is tried: standing, sitting on a chair, sitting on the floor, lying, the leg raises on the bars", () => {
    expect(others.length).toBeGreaterThanOrEqual(120);
    const near = ["leg_raise_bars", "knee_raise_bars", "straight_leg_raise_chair", "support_hold_bars", "usual_v08", "usual_v10", "usual_v12", "usual_v05", "usual_v07", "usual_v13"];
    expect(near.filter((l) => !others.some((r) => r.label === l))).toEqual([]);
  });

  it("each is timed 0", () => {
    expect(others.filter((r) => r.heldMs !== 0).map((r) => [r.label, r.heldMs])).toEqual([]);
  });

  it("with every set of numbers made with one person left out, too", () => {
    expect(TABLE.worstOther).toBe(0);
  });

  it("each L-sit is timed as the pictures show it held, within a quarter of a second", () => {
    const own = TABLE.rows.filter((r) => r.entry.movement === L_SIT.name);
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const r of own) {
      const eye = heldByEye(r.entry);
      expect([r.label, Math.abs(r.heldMs - eye) <= HOLD_ROOM]).toEqual([r.label, true]);
      // With the person's own videos left out of the numbers: the same, or the case written on the video, never more.
      const known = forMovement(r.entry, L_SIT.name).leftOutOpen;
      if (r.leftOutMs !== null) expect([r.label, known?.fewer === true ? r.leftOutMs < eye : Math.abs(r.leftOutMs - eye) <= HOLD_ROOM]).toEqual([r.label, true]);
    }
  });

  it("two people, so each alone sets lines the other misses: both cases written on their videos, each timed less with himself left out, never more", () => {
    const fewer = TABLE.rows.filter((r) => forMovement(r.entry, L_SIT.name).leftOutOpen?.fewer === true).map((r) => [r.label, Math.round(r.heldMs), r.leftOutMs]);
    expect(fewer).toEqual([
      ["l_sit_bars_1", 7867, 0],
      ["l_sit_bars_2", 3100, 0],
    ]);
  });

  it("the clock stops at the last picture the legs are held up: never a moment after they come down", () => {
    // l_sit_bars_2: held to 3.10 s; at 3.13 s the video cuts to him in a support, his knees bent and hanging.
    const row = TABLE.rows.find((r) => r.label === "l_sit_bars_2");
    expect(row?.holds.map((h) => [h.start, h.end])).toEqual([[0, 3100]]);
  });

  it("under every held replay each L-sit is timed as it must be, and every other movement 0", () => {
    const rows = holdReplayTable(L_SIT, VIDEOS.filter((v) => v.entry.movement === L_SIT.name || ["leg_raise_bars", "knee_raise_bars", "usual_v08", "support_hold_bars"].includes(v.video.label)), REPLAYS.filter((r) => r.hold)).filter((r) => r.tried);
    expect(new Set(rows.map((r) => r.replay.name)).size).toBe(REPLAYS.filter((r) => r.hold).length);
    expect(rows.filter((r) => !holdHolds(r)).map((r) => [r.replay.name, r.label, r.heldMs, r.least, r.most])).toEqual([]);
  }, 600_000);
});

describe("the support hold on the bars is timed only: to the camera it is a person standing with the arms by the sides", () => {
  const file = readMovementFile("support-hold");

  it("its file is timed only, and says why in a line", () => {
    expect(file.counting).toBe("timed only");
    expect(timedMovementSchema.safeParse(file).success).toBe(true);
  });

  it("made as a hold from his video, it would time people standing in the other videos: so it is never a hold", () => {
    const tried: HoldMovement = SUPPORT_AS_A_HOLD;
    const standing = VIDEOS.filter((v) => v.entry.movement !== "support-hold" && ["squat_reference", "usual_v02", "usual_v14", "calf_raise"].some((l) => v.video.label === l));
    expect(standing).toHaveLength(4);
    const timed = standing.filter((v) => runHold(tried, v.video).heldMs > 0).map((v) => v.video.label);
    expect(timed.length).toBeGreaterThanOrEqual(3);
  });
});

describe("a hold's clock, frame by frame", () => {
  it("runs only after the position has held for a whole second, and then counts that second too", () => {
    expect(HOLD_LIMITS.settle).toBe(1000);
    const frames = Array.from({ length: 31 }, (_, k) => ({ t: k * 100, holds: k <= 8 }));
    // Held 0.8 s, then let go: never a hold.
    expect(heldOf(frames).heldMs).toBe(0);
    const longer = Array.from({ length: 31 }, (_, k) => ({ t: k * 100, holds: k <= 15 }));
    expect(heldOf(longer).heldMs).toBe(1500);
  });

  it("a picture the camera could not read is not held time, and a gap longer than a break ends the hold", () => {
    const frames = Array.from({ length: 41 }, (_, k) => ({ t: k * 100, holds: k < 12 || k > 14 ? true : null }));
    // 0 to 1.1 s held, 1.2 to 1.4 s unread (300 ms, past the 200 ms break), 1.5 to 4.0 s held.
    expect(heldOf(frames).holds.map((h) => [h.start, h.end])).toEqual([
      [0, 1100],
      [1500, 4000],
    ]);
  });

  it("refuses a hold that names a measure the engine does not have", () => {
    const bad: HoldMovement = { ...L_SIT, position: [{ read: { kind: "value", measures: ["left wing"] }, atLeast: 1, from: "x" }] };
    expect(() => {
      checkHold(bad);
    }).toThrow(/left wing/);
    expect(() => new HoldMatcher(bad)).toThrow();
  });

  it("the three kinds of file parse by their kind, and a movement counted by reps is never read as a hold", () => {
    expect(holdMovementSchema.safeParse(L_SIT).success).toBe(true);
    expect(movementFileSchema.safeParse(L_SIT).success).toBe(true);
    expect(parseMovementFile(readMovementFile("sit-up")).counting).toBe("rep");
    expect(() => readHold("sit-up")).toThrow(/not a hold/);
  });
});

/** The support hold as a hold, from his one video: the body upright, the knees and hips straight, the elbows straight, the
 *  arms by the sides (each within the room his video shows, from its readings while he holds). */
const SUPPORT_AS_A_HOLD: HoldMovement = {
  format: 1,
  name: "support-hold-tried",
  counting: "hold",
  phone: "Side-on or from the front, the whole body in the picture.",
  position: [
    { read: { kind: "value", measures: ["trunk lean"] }, atMost: 15, from: "His video: 0 to 4 degrees, with room." },
    { read: { kind: "value", measures: ["left hip", "right hip"] }, atLeast: 160, from: "His video: 172 to 179." },
    { read: { kind: "value", measures: ["left knee", "right knee"] }, atLeast: 160, from: "His video: 175 to 177." },
    { read: { kind: "value", measures: ["left elbow", "right elbow"] }, atLeast: 160, from: "His video: 176 to 180." },
    { read: { kind: "value", measures: ["left shoulder", "right shoulder"] }, atMost: 30, from: "His video: 12 to 17." },
  ],
  unseen: "Keep your whole body in view.",
};

describe("a hold's set summary: the time held, no reps, no form score yet", () => {
  it("his L-sit on the dip station: held from when the body is learned to 3.10 s, watched all but the first half second", () => {
    const v = VIDEOS.find((x) => x.video.label === "l_sit_bars_2");
    if (v === undefined) throw new Error("no video");
    const exercise: ExerciseCamera = {
      format: 1,
      id: "l_sit",
      version: 1,
      movement: "l-sit",
      research: "Kd's research file, \"Parallel-Bar Tuck L-Sit\".",
      mistakes: [{ id: "legs_sag", name: "Legs sagging below level", source: "Kd's research file.", camera: "not checked", why: "54 checks a hold's mistakes." }],
    };
    const record = new HoldRecord(exercise, L_SIT, 1);
    const { measured } = runOf(v.video);
    const matcher = new HoldMatcher(L_SIT);
    for (const m of measured) record.add(matcher.next(m));
    const last = matcher.finish();
    if (last !== null) record.add(last);
    const s = record.summary();
    expect(engineSetSummarySchema.safeParse(s).success).toBe(true);
    expect([s.reps, s.repScores, s.avgFormScore, s.engineVersion]).toEqual([0, [], null, "2.1.0"]);
    // Read without the held first picture, the body is learned in its first half second: the clock then runs from 0.50 s.
    expect(Math.abs((s.holdMs ?? 0) - 2600) <= HOLD_ROOM).toBe(true);
    // Watched from 0.50 s, when the body is learned: the whole set but its first half second.
    expect(Math.abs(s.durationMs - (s.watchedMs ?? 0) - 500) <= 34).toBe(true);
  });
});