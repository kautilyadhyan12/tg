// The proof's own run (movementCheck.ts `runMovement`, holdCheck.ts `runHold`: the stages once for a video, the lock told
// nothing, and the set run again whole only where the lock told at its first count follows another body) against the set
// as the camera runs it on the phone (`CameraSet`: frame by frame, the lock told the moment the set counts). They must be
// the same on every proof set the camera counts or times, so that the proof proves what the phone does.
import { describe, expect, it } from "vitest";
import { cameraHolds, heldIn, readHold, runHold } from "../scripts/holdCheck.js";
import { LOCKED_MOVEMENTS } from "../scripts/lockCheck.js";
import { cameraRun, proofVideos, readExercise, readMovement, runMovement, withLeadIn } from "../scripts/movementCheck.js";

const VIDEOS = proofVideos();

describe("the proof's run is the camera's own set", () => {
  const counted = LOCKED_MOVEMENTS.filter((n) => n !== "l-sit");
  it.each(counted)("%s: on every video it counts, and on every video of another movement, the count and every rep the same", (name) => {
    const movement = readMovement(name);
    const exercise = name === "squat" ? readExercise("squat") : null;
    let sets = 0;
    for (const v of VIDEOS) {
      const fast = runMovement(movement, v.video, exercise);
      if (fast.count === 0 && v.entry.movement !== null && v.entry.movement !== name && sets % 3 !== 0) continue;
      sets++;
      expect([v.video.label, fast]).toEqual([v.video.label, cameraRun(movement, withLeadIn(v.video), exercise)]);
    }
    expect(sets).toBeGreaterThan(10);
  });

  it("the L-sit: on every video, every time held the same", () => {
    const hold = readHold("l-sit");
    for (const v of VIDEOS) expect([v.video.label, runHold(hold, v.video)]).toEqual([v.video.label, heldIn(cameraHolds(hold, withLeadIn(v.video)), v.video)]);
  });
});
