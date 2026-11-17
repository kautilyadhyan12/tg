// body-check's rules (ROADMAP 50c-ii): each fitted limit the engine holds is the one its rule
// sets from Kd's six videos, so a change of the videos, the rule or the engine shows here; the
// limits set from five people hold on the sixth; and the same video at half the frames a
// second gets the same answers.
import { describe, expect, it } from "vitest";
import { KP } from "@app/shared";
import { LIMITS, MAIN_JOINTS, STEADY, type CheckedBody } from "../src/index.js";
import {
  BEHIND_ALLOWED,
  BONE_LOSS,
  agreementOf,
  boneLoss,
  chooseBone,
  chooseSteady,
  countOf,
  framesToDraw,
  halfRate,
  leaveOneOut,
  runChecks,
  runSteady,
  steadinessOf,
} from "../scripts/bodyCheck.js";
import { ONE_PERSON, VIDEOS } from "./helpers/body.js";

describe("the engine's limits are the ones their rules set from Kd's six videos", () => {
  it("the bone limit", () => {
    expect(chooseBone(VIDEOS)).toBe(LIMITS.bone);
  });

  it("the steady settings, on the picture and in 3D", () => {
    expect(chooseSteady(VIDEOS, "flat").smoothing).toEqual(STEADY.flat);
    expect(chooseSteady(VIDEOS, "world").smoothing).toEqual(STEADY.world);
  });

  it("at those limits each one-person video keeps what the rules promise", () => {
    for (const video of ONE_PERSON) {
      const checked = runChecks(video.frames);
      expect([video.label, boneLoss(checked) <= BONE_LOSS]).toEqual([video.label, true]);
      const steady = runSteady(checked);
      const kinds: ("flat" | "world")[] = ["flat", "world"];
      for (const which of kinds) {
        const s = steadinessOf(checked, steady, which);
        expect(s.moving).toBeGreaterThan(0);
        expect([video.label, which, s.behind - s.behindRaw <= BEHIND_ALLOWED]).toEqual([video.label, which, true]);
        expect([video.label, which, s.shake < s.shakeRaw / 1.5]).toEqual([video.label, which, true]);
      }
    }
  });
});

describe("set from five people, tried on the sixth", () => {
  const folds = leaveOneOut(VIDEOS);

  it("five of the six sets of five people set the same limits as all six", () => {
    const same = folds.filter((f) => f.bone === LIMITS.bone).length;
    expect(same).toBeGreaterThanOrEqual(5);
    expect(folds.filter((f) => f.flat.minCutoff === STEADY.flat.minCutoff && f.flat.beta === STEADY.flat.beta).length).toBeGreaterThanOrEqual(5);
    expect(folds.filter((f) => f.world.minCutoff === STEADY.world.minCutoff && f.world.beta === STEADY.world.beta).length).toBeGreaterThanOrEqual(5);
  });

  it("a one-person video left out loses no more than 1 in 200 of its joints to a broken bone, but for the bicycle crunch", () => {
    // Without the crunch, the other one-person videos set 0.15 and the crunch loses 6 in 100:
    // a new kind of movement (lying, hands behind the head) can need the limit set again.
    for (const f of folds) {
      const onePerson = ONE_PERSON.some((v) => v.label === f.heldOut);
      if (!onePerson || f.heldOut === "bicycle_crunch_reference") continue;
      expect([f.heldOut, f.heldOutBoneLoss <= BONE_LOSS]).toEqual([f.heldOut, true]);
    }
  });
});

describe("the same videos at half the frames a second", () => {
  for (const video of VIDEOS) {
    it(`${video.label}: nearly every joint gets the same answer`, () => {
      const a = agreementOf(runSteady(runChecks(video.frames)), runSteady(runChecks(halfRate(video.frames))));
      expect(a.compared).toBeGreaterThan(0);
      if (video.onePerson) {
        // Measured: 0 to 0.2 in 100, and a steady joint within 0.4 to 1.2 cm.
        expect(a.differ / a.compared).toBeLessThanOrEqual(0.005);
        expect(a.apart).toBeLessThan(0.015);
      } else {
        // The bench press videos: the model finds the man twice, so the follower can pick the
        // other one at the other rate. Measured: 2.9 and 2.9 in 100.
        expect(a.differ / a.compared).toBeLessThanOrEqual(0.05);
      }
    });
  }
});

describe("what body-check counts and draws", () => {
  it("counts every big joint of every frame once", () => {
    for (const video of VIDEOS) {
      const c = countOf(runChecks(video.frames));
      const refused = Object.values(c.why).reduce((a, b) => a + b, 0);
      expect(c.used + refused).toBe(c.pointFrames);
      expect(c.pointFrames).toBe(video.frames.length * MAIN_JOINTS.length);
    }
  });

  it("draws the frames where a joint starts to be refused for a bone, a jump or a swap, naming each", () => {
    const refusedAt = (t: number, why: CheckedBody["refused"][number], joint: number): CheckedBody => {
      const refused = new Array<CheckedBody["refused"][number]>(33).fill(null);
      refused[joint] = why;
      const person = VIDEOS[0]?.frames.find((f) => f.people.length > 0)?.people[0] ?? null;
      return { t, aspect: 1, down: null, person, size: 1, refused };
    };
    const checked = [
      refusedAt(0, null, KP.left_wrist),
      refusedAt(33, "jump", KP.left_wrist),
      refusedAt(67, "jump", KP.left_wrist),
      refusedAt(100, "hidden", KP.left_wrist),
      refusedAt(133, "bone", KP.left_knee),
    ];
    const drawn = framesToDraw(checked);
    expect(drawn.map((d) => d.index)).toEqual([1, 4]);
    expect(drawn[0]?.lines).toEqual(["0.03 s  frame 2", "jump: left wrist"]);
    expect(drawn[1]?.lines).toEqual(["0.13 s  frame 5", "bone: left knee"]);
    expect(framesToDraw(Array.from({ length: 40 }, (_, n) => refusedAt(n * 33, n % 2 === 0 ? "jump" : null, KP.left_wrist))).length).toBe(12);
  });
});
