// The worst thing (ROADMAP 52a-ii-a, and 52a-ii-b-i for a phone on the floor or low): a jump counted as a squat. Hops true to gravity (in the air 2·√(2h/g), the whole
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

describe("the same jumps drawn on a man's own squats, his phone on the floor and raised (52a-ii-b-i)", () => {
  // His nine sets: side on, half turned and from the front on a shiny floor, side on on a dull one, and five from a raised
  // phone (round one: the test first tried three of them).
  const FLOOR = VIDEOS.filter((v) => v.entry.person === "man, his own phone, on the floor and raised" && v.entry.movement === "squat" && v.entry.reps !== null).map((v) => v.video.label);
  /** Counted, in plain sight until a job closes them (52a-ii-b-ii): 55 jumps of 8 to 12 cm of 810 (37 of 8 cm, 14 of 10, 4 of
   *  12), most taking off 0.1 to 0.2 s before the rep is back up, six of them as filmed. From a phone on the floor or low the model's foot points wander by 4 to 9
   *  cm, so a jump's feet read only a few centimetres above where his feet stand, under the 4 cm the rule is held at by
   *  the jumps of 52a-ii-a, which are all refused. Every way of placing a foot's resting point, and every other sign tried
   *  (the hips, the knees, a picture agreeing), refused some of his proper squats or let more jumps through. */
  const KNOWN: readonly string[] = [
    "floor_phone_test 0-12 s, 0.08 m, -200 ms, 8 a second",
    "floor_phone_test 0-12 s, 0.08 m, -200 ms, uneven, seed 2",
    "floor_phone_test 0-12 s, 0.08 m, -200 ms, uneven, seed 3",
    "floor_phone_test 0-12 s, 0.08 m, -100 ms, as filmed",
    "floor_phone_test 0-12 s, 0.08 m, -100 ms, 15 a second",
    "floor_phone_test 0-12 s, 0.08 m, -100 ms, uneven, seed 1",
    "floor_phone_test 0-12 s, 0.08 m, -100 ms, uneven, seed 3",
    "floor_phone_test 13.9-21.1 s, 0.08 m, -100 ms, 15 a second",
    "floor_phone_test 13.9-21.1 s, 0.08 m, -100 ms, uneven, seed 1",
    "floor_phone_test 22.3-31.4 s, 0.08 m, -100 ms, 8 a second",
    "usual_v04 9.8-23.2 s, 0.08 m, -200 ms, 8 a second",
    "usual_v04 9.8-23.2 s, 0.1 m, -200 ms, 8 a second",
    "usual_v11 1.3-7.4 s, 0.08 m, -200 ms, 8 a second",
    "usual_v11 1.3-7.4 s, 0.08 m, -200 ms, uneven, seed 2",
    "usual_v11 1.3-7.4 s, 0.08 m, -200 ms, uneven, seed 3",
    "usual_v11 1.3-7.4 s, 0.08 m, -100 ms, as filmed",
    "usual_v11 1.3-7.4 s, 0.08 m, -100 ms, 15 a second",
    "usual_v11 1.3-7.4 s, 0.08 m, -100 ms, 8 a second",
    "usual_v11 1.3-7.4 s, 0.08 m, -100 ms, uneven, seed 1",
    "usual_v11 1.3-7.4 s, 0.08 m, -100 ms, uneven, seed 2",
    "usual_v11 1.3-7.4 s, 0.08 m, -100 ms, uneven, seed 3",
    "usual_v11 1.3-7.4 s, 0.1 m, -200 ms, uneven, seed 2",
    "usual_v11 1.3-7.4 s, 0.1 m, -100 ms, as filmed",
    "usual_v11 1.3-7.4 s, 0.1 m, -100 ms, 15 a second",
    "usual_v11 1.3-7.4 s, 0.1 m, -100 ms, 8 a second",
    "usual_v11 1.3-7.4 s, 0.1 m, -100 ms, uneven, seed 1",
    "usual_v11 1.3-7.4 s, 0.1 m, -100 ms, uneven, seed 2",
    "usual_v11 1.3-7.4 s, 0.1 m, -100 ms, uneven, seed 3",
    "usual_v11 1.3-7.4 s, 0.12 m, -200 ms, as filmed",
    "usual_v11 1.3-7.4 s, 0.12 m, -200 ms, 15 a second",
    "usual_v11 1.3-7.4 s, 0.12 m, -100 ms, 15 a second",
    "usual_v11 1.3-7.4 s, 0.12 m, -100 ms, uneven, seed 1",
    "usual_v11 8.3-14.2 s, 0.08 m, -200 ms, as filmed",
    "usual_v11 8.3-14.2 s, 0.08 m, -200 ms, 15 a second",
    "usual_v11 8.3-14.2 s, 0.08 m, -200 ms, 8 a second",
    "usual_v11 8.3-14.2 s, 0.08 m, -200 ms, uneven, seed 1",
    "usual_v11 8.3-14.2 s, 0.08 m, -200 ms, uneven, seed 2",
    "usual_v11 8.3-14.2 s, 0.08 m, -200 ms, uneven, seed 3",
    "usual_v11 8.3-14.2 s, 0.1 m, -200 ms, uneven, seed 2",
    "usual_v11 8.3-14.2 s, 0.1 m, -200 ms, uneven, seed 3",
    "usual_v11 30-39 s, 0.08 m, -200 ms, 15 a second",
    "usual_v11 30-39 s, 0.08 m, -200 ms, 8 a second",
    "usual_v11 30-39 s, 0.08 m, -200 ms, uneven, seed 1",
    "usual_v11 30-39 s, 0.08 m, -200 ms, uneven, seed 2",
    "usual_v11 30-39 s, 0.08 m, -200 ms, uneven, seed 3",
    "usual_v11 30-39 s, 0.08 m, -100 ms, as filmed",
    "usual_v11 30-39 s, 0.08 m, -100 ms, 15 a second",
    "usual_v11 30-39 s, 0.08 m, -100 ms, 8 a second",
    "usual_v11 30-39 s, 0.08 m, -100 ms, uneven, seed 1",
    "usual_v11 30-39 s, 0.08 m, -100 ms, uneven, seed 2",
    "usual_v11 30-39 s, 0.08 m, -100 ms, uneven, seed 3",
    "usual_v11 30-39 s, 0.1 m, -200 ms, 8 a second",
    "usual_v11 30-39 s, 0.1 m, -200 ms, uneven, seed 1",
    "usual_v11 30-39 s, 0.1 m, -200 ms, uneven, seed 2",
    "usual_v11 30-39 s, 0.1 m, -100 ms, uneven, seed 3",
  ];

  it("his nine sets, each hopped at most of its reps, so the grid proves something", () => {
    expect(FLOOR).toHaveLength(9);
    for (const label of FLOOR) {
      const video = videoOf(label);
      const reps = countedTimes(SQUAT, video).length;
      for (const offset of OFFSETS) expect([label, offset, unhopped(video, 0.12, offset) < reps]).toEqual([label, offset, true]);
    }
  });

  it("a jump of 8 to 12 cm is counted only in the known cases, written", () => {
    const counted: string[] = [];
    for (const label of FLOOR) {
      const video = videoOf(label);
      for (const metres of [0.08, 0.1, 0.12]) {
        for (const offset of OFFSETS) {
          const hopped = trueHop(video, metres, offset);
          const most = unhopped(video, metres, offset);
          for (const [name, seen] of SEEN) {
            if (runMovement(SQUAT, seen(hopped)).count > most) counted.push(`${label}, ${String(metres)} m, ${String(offset)} ms, ${name}`);
          }
        }
      }
    }
    expect(counted).toEqual(KNOWN);
  });

  it("a jump of 15 or 20 cm is never counted on any of his sets, however the phone sees it", () => {
    for (const label of FLOOR) {
      const video = videoOf(label);
      for (const metres of [0.15, 0.2]) {
        for (const offset of OFFSETS) {
          const hopped = trueHop(video, metres, offset);
          const most = unhopped(video, metres, offset);
          for (const [name, seen] of SEEN) expect([label, metres, offset, name, runMovement(SQUAT, seen(hopped)).count <= most]).toEqual([label, metres, offset, name, true]);
        }
      }
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

  it("the known limit, in plain sight: side on, with only the near foot seen, a jump from the bottom counts up to 8 cm and is refused from 10", () => {
    // At the bottom the model slides that foot 2.6 to 4.4 cm up the picture itself (the green-mat man), so one foot
    // decides nothing there; a hop from the bottom is a squat done with a hop, never a squat jump (refused above). Until
    // 52a-ii-b-i a 10 cm one counted too.
    const video = videoOf("squat_reference");
    for (const offset of [-150, -50, 50]) {
      expect([offset, runMovement(SQUAT, trueHop(video, 0.08, offset, {}, null, "bottom")).count]).toEqual([offset, 3]);
      expect([offset, runMovement(SQUAT, trueHop(video, 0.1, offset, {}, null, "bottom")).count]).toEqual([offset, 0]);
      expect([offset, runMovement(SQUAT, trueHop(video, 0.12, offset, {}, null, "bottom")).count]).toEqual([offset, 0]);
    }
  });
});
