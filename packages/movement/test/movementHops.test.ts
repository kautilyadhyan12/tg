// The worst thing (ROADMAP 52a-ii-a): a jump counted as a squat. Hops true to gravity (in the air 2·√(2h/g), the whole
// body carried up), at five take-off times round each rep's top, on three squat videos (side on, in between with no
// pause between reps, from the front), as filmed and as the phone gives pictures: 15 and 8 a second, and skipped
// unevenly with three seeds. Kd's four squat-jump videos lift the ankles 12 to 34 cm.
import { describe, expect, it } from "vitest";
import { countedTimes, runMovement } from "../scripts/movementCheck.js";
import { everyNth, uneven } from "../scripts/replays.js";
import type { Video } from "../scripts/bodyCheck.js";
import { hopTime } from "../src/index.js";
import { trueHop } from "./helpers/hops.js";
import { SQUAT, VIDEOS } from "./helpers/replays.js";

const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v.video;
};
const LABELS = ["squat_reference", "prisoner_squat_3", "sumo_squat_2a"];
const OFFSETS = [-200, -100, 0, 100, 200];
const SEEN: readonly (readonly [string, (v: Video) => Video])[] = [
  ["as filmed", (v) => v],
  ["15 a second", (v) => ({ ...v, frames: everyNth(15)(v.frames) })],
  ["8 a second", (v) => ({ ...v, frames: everyNth(8)(v.frames) })],
  ...[1, 2, 3].map((seed): readonly [string, (v: Video) => Video] => [`uneven, seed ${String(seed)}`, (v) => ({ ...v, frames: uneven(4)(v.frames, seed) })]),
];

/** The reps whose hop would not lie wholly inside the video (its last picture is held after it): never hopped. */
function unhopped(video: Video, metres: number, offset: number, from: "back" | "bottom" = "back"): number {
  const last = video.frames[video.frames.length - 1]?.t ?? 0;
  return countedTimes(SQUAT, video).filter((r) => (from === "back" ? r.end : (r.start + r.end) / 2) + offset + hopTime(metres) > last).length;
}

describe("the worst thing: a jump of 8 cm or more is never counted as a squat, however the phone sees it", () => {
  for (const label of LABELS) {
    const video = videoOf(label);
    it.each([0.08, 0.1, 0.12])(`${label}: a %s m jump at every take-off time, under every way of seeing it, counts only reps it never reached`, (metres) => {
      for (const offset of OFFSETS) {
        const hopped = trueHop(video, metres, offset);
        const most = unhopped(video, metres, offset);
        for (const [name, seen] of SEEN) {
          const count = runMovement(SQUAT, seen(hopped)).count;
          expect([offset, name, count, count <= most]).toEqual([offset, name, count, true]);
        }
      }
    });
  }

  it("each video is hopped at most of its reps, so the rows above prove something", () => {
    for (const label of LABELS) {
      const video = videoOf(label);
      const reps = countedTimes(SQUAT, video).length;
      for (const offset of OFFSETS) expect([label, offset, unhopped(video, 0.1, offset) < reps]).toEqual([label, offset, true]);
    }
  });
});

describe("a jump from the bottom of a rep", () => {
  it.each(["prisoner_squat_1", "prisoner_squat_3", "sumo_squat_2a"])("%s, both feet seen: 8 cm or more is never counted", (label) => {
    const video = videoOf(label);
    for (const metres of [0.08, 0.1, 0.12]) {
      for (const offset of [-150, -50, 50]) {
        const hopped = trueHop(video, metres, offset, {}, null, "bottom");
        for (const [name, seen] of SEEN.slice(0, 3)) expect([metres, offset, name, runMovement(SQUAT, seen(hopped)).count]).toEqual([metres, offset, name, unhopped(video, metres, offset, "bottom")]);
      }
    }
  });

  it("the known limit, in plain sight: side on, with only the near foot seen, a jump from the bottom counts up to 10 cm and is refused from 12", () => {
    // At the bottom the model slides that foot 2.6 to 4.4 cm up the picture itself (the green-mat man), so one foot
    // decides nothing there; a hop from the bottom is a squat done with a hop, never a squat jump (refused above).
    const video = videoOf("squat_reference");
    for (const offset of [-150, -50, 50]) {
      expect([offset, runMovement(SQUAT, trueHop(video, 0.1, offset, {}, null, "bottom")).count]).toEqual([offset, 3]);
      expect([offset, runMovement(SQUAT, trueHop(video, 0.12, offset, {}, null, "bottom")).count]).toEqual([offset, 0]);
    }
  });
});
