// The worst thing (ROADMAP 52a-ii-a), when the camera does not see the jump whole: the feet hidden in the air in
// pictures that came, no picture at all for a while (the phone busy), and one foot lost across the take-off with the
// other lost in the air. Jumps of 10 to 15 cm, true to gravity, at four take-off times, on three squat videos. No such
// jump counts: a break that could hide one leaves the rep unseen, a rep is not judged while its feet are hidden, and a
// foot lost for longer than a break reads nothing, never 0.
import { describe, expect, it } from "vitest";
import { countedTimes, runMovement } from "../scripts/movementCheck.js";
import type { Video } from "../scripts/bodyCheck.js";
import { hopTime } from "../src/index.js";
import { trueHop } from "./helpers/hops.js";
import { SQUAT, VIDEOS } from "./helpers/replays.js";

const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v.video;
};
const FEET = [27, 28, 29, 30, 31, 32];
const LEFT = [27, 29, 31];
const RIGHT = [28, 30, 32];
const over = (points: readonly number[], span: readonly [number, number]) => Object.fromEntries(points.map((k) => [k, span]));

/** The reps whose jump would not lie wholly inside the video: never jumped. */
function unhopped(video: Video, metres: number, offset: number): number {
  const last = video.frames[video.frames.length - 1]?.t ?? 0;
  return countedTimes(SQUAT, video).filter((r) => r.end + offset + hopTime(metres) > last).length;
}

describe("the worst thing: a jump the camera does not see whole is never counted", () => {
  for (const label of ["prisoner_squat_3", "squat_reference", "sumo_squat_2a"]) {
    const video = videoOf(label);
    it.each([0.1, 0.15])(`${label}: a %s m jump, its feet hidden or its pictures missing round its top, or one foot lost at take-off`, (metres) => {
      const top = hopTime(metres) / 2;
      for (const offset of [-100, 0, 122, 200]) {
        const most = unhopped(video, metres, offset);
        for (const hole of [130, 150, 180]) {
          const span = [top - hole / 2, top + hole / 2] as const;
          const hidden = runMovement(SQUAT, trueHop(video, metres, offset, over(FEET, span))).count;
          const missing = runMovement(SQUAT, trueHop(video, metres, offset, {}, span)).count;
          expect([offset, hole, hidden <= most, missing <= most]).toEqual([offset, hole, true, true]);
        }
        // The left foot hidden from just before take-off to 110 ms after, the right from 8 to 110 ms.
        const lost = runMovement(SQUAT, trueHop(video, metres, offset, { ...over(LEFT, [-25, 110]), ...over(RIGHT, [8, 110]) })).count;
        expect([offset, lost <= most]).toEqual([offset, true]);
      }
    });
  }
});
