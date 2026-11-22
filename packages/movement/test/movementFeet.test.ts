// The feet leaving the floor, read so that a foot the camera reads poorly does not hide a jump (ROADMAP
// 52a-ii-b-ii-b-ii; spec Part 2 §12.5 "As built, the floor mended in the engine"). Two rules: a foot point not seen while
// the person stood just before the rep (side on, the far foot, hidden behind the near one, shows during the squat) rests
// where it was lowest, never where it stood once back up, where a jump's feet are in the air; and away from the bottom,
// where both feet are read, a foot whose heel and toes disagree is set aside for the other (on a man's raised phone a toe
// point slides 8 cm down the picture as he stands up, and the lesser of the two feet hid an 8 cm jump).
import { describe, expect, it } from "vitest";
import { countedTimes, replayed, runMovement } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";
import { editPeople } from "./helpers/body.js";
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

describe("the worst thing: a properly done squat is never refused because a foot is read differently", () => {
  it("a weight-plate goblet squat with every point shaken 1 cm counts its four squats: at the bottom both feet are still read together", () => {
    // Found while building: set aside at the bottom too, her left foot (heel 7 cm up the picture, toes 1) left her right
    // foot's own 3 to 4 cm slide alone, and one of her squats read as the feet leaving the floor.
    expect(replayed(SQUAT, proofOf("fresh_goblet_squat_plate"), replayOf("shaky")).count).toBe(4);
  });

  it("his last raised pair, his left foot hidden while he stands and seen through each squat, counts both: that foot is still read, and his right foot's slide decides nothing alone", () => {
    // Round one's case: with a foot not seen before the rep set aside, his right foot was read alone, its toe point
    // sliding as he stood up, and his first squat was refused (4.7 cm, the rule 4).
    const v = proofOf("usual_v11 30-39 s");
    const reps = countedTimes(SQUAT, v.video);
    const inRep = (t: number): boolean => reps.some((r) => t >= r.start && t <= r.end + 400);
    const frames = editPeople(v.video.frames, (p, f) => (inRep(f.t) ? p : { ...p, points: p.points.map((q, i) => (i === 29 || i === 31 ? [q[0], q[1], q[2], 0.1, q[4]] : q)) }));
    expect(reps).toHaveLength(2);
    expect(runMovement(SQUAT, { ...v.video, frames }).count).toBe(2);
  });
});

describe("a jump is not hidden by a foot the camera reads poorly", () => {
  it("his raised set side on, half turned: the far foot, not seen while he stood and resting where it was lowest, no longer hides an 8 cm jump taking off 0.1 s before he is back up", () => {
    const v = proofOf("usual_v11 1.3-7.4 s");
    expect(runMovement(SQUAT, trueHop(v.video, 0.08, -100)).count).toBe(0);
  });

  it("his last raised pair: one foot's toe point sliding 8 cm down the picture as he stands no longer hides an 8 cm jump; the other foot is read", () => {
    const v = proofOf("usual_v11 30-39 s");
    expect(runMovement(SQUAT, trueHop(v.video, 0.08, -100)).count).toBe(0);
  });
});
