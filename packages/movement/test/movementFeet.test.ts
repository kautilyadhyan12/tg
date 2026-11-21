// The feet leaving the floor, read only from the feet the camera reads well (ROADMAP 52a-ii-b-ii-b-ii; spec Part 2
// §12.5 "As built, the floor mended in the engine"). Two rules: a foot point the camera did not see while the person
// stood just before the rep decides nothing about the feet leaving the floor (side on, the far foot, hidden behind the
// near one, shows during a squat from the model's guess); and away from the bottom, where both feet are read, a foot whose
// heel and toes disagree is set aside for the other (on a man's raised phone a toe point slides 8 cm down the picture as
// he stands up, and the lesser of the two feet hid an 8 cm jump).
import { describe, expect, it } from "vitest";
import { FOOT_ENDS_AGREE, hopTime } from "../src/index.js";
import { countedTimes, replayed, runMovement } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";
import { trueHop } from "./helpers/hops.js";
import { SQUAT, VIDEOS } from "./helpers/replays.js";

const proofOf = (label: string) => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v;
};
const replayOf = (name: string) => {
  const r = REPLAYS.find((x) => x.name === name);
  if (r === undefined) throw new Error(`no replay ${name}`);
  return r;
};

describe("the worst thing: a properly done squat is never refused because a foot is set aside", () => {
  it("a weight-plate goblet squat with every point shaken 1 cm counts its four squats: at the bottom both feet are still read together", () => {
    // Found while building: set aside at the bottom too, her left foot (heel 7 cm up the picture, toes 1) left her right
    // foot's own 3 to 4 cm slide alone, and one of her squats read as the feet leaving the floor.
    expect(replayed(SQUAT, proofOf("fresh_goblet_squat_plate"), replayOf("shaky")).count).toBe(4);
  });

  it("his ten sets, his phone on the floor and raised, count what he did, as filmed", () => {
    const his = VIDEOS.filter((v) => v.entry.person === "man, his own phone, on the floor and raised" && v.entry.movement === "squat" && v.entry.reps !== null);
    expect(his.map((v) => [v.video.label, runMovement(SQUAT, v.video).count])).toEqual(his.map((v) => [v.video.label, v.entry.reps]));
  });

  it("the limit a foot's heel and toes may disagree by is set from the drawn jumps, written (3 cm)", () => {
    expect(FOOT_ENDS_AGREE).toBe(0.03);
  });
});

describe("a jump is not hidden by a foot the camera reads poorly", () => {
  it("his raised set side on, half turned: the far foot first seen during the rep no longer hides an 8 cm jump taking off 0.1 s before he is back up", () => {
    const v = proofOf("usual_v11 1.3-7.4 s");
    expect(runMovement(SQUAT, trueHop(v.video, 0.08, -100)).count).toBe(0);
  });

  it("his last raised pair: one foot's toe point sliding 8 cm down the picture as he stands no longer hides an 8 cm jump; the other foot is read", () => {
    const v = proofOf("usual_v11 30-39 s");
    expect(runMovement(SQUAT, trueHop(v.video, 0.08, -100)).count).toBe(0);
  });

  it("with the far foot set aside, a jump whose near foot is hidden in the air is still never counted, for a movement whose one rule on the feet is leaving the floor", () => {
    // For the squat "feet stay in place" also needs the feet seen and refuses this on its own, so the squat is tried
    // without it. A frame in which only a foot point not seen before the rep is read has its feet unseen too (the
    // matcher's `known`); no kept video reaches a case where that alone decides (scanned: every judged squat set, jumps of
    // 8 and 10 cm at five take-off times with either foot hidden in the air), so this test checks the break, not that.
    const v = proofOf("usual_v11 1.3-7.4 s");
    const liftOnly = { ...SQUAT, rules: SQUAT.rules.filter((r) => r.read.kind !== "travel") };
    const air = hopTime(0.1);
    expect(countedTimes(SQUAT, v.video)).toHaveLength(2);
    expect(runMovement(liftOnly, v.video).count).toBe(2);
    expect(runMovement(liftOnly, trueHop(v.video, 0.1, 0, { 28: [0, air], 30: [0, air], 32: [0, air] })).count).toBe(0);
  });
});
