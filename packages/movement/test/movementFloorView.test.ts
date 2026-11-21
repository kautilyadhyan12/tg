// A phone standing on the floor, every proof video redrawn as it would see them (ROADMAP 52a-ii-b-ii-a; spec Part 2
// §12.5 "As built, the floor view"). The worst thing this job could do to a person: a floor view that does not look as a
// real floor phone looks would prove that an exercise counts from the floor when it does not, and a member's proper reps
// would go uncounted, or a jump be counted. So first: a jump seen from the floor is never a squat; then the redraw is
// kept only because a man's own squats from a raised phone, redrawn, read as his real floor squats do.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Video } from "../scripts/bodyCheck.js";
import { readKept } from "../scripts/bodyCheck.js";
import { faithful, phoneLean, positionsTable } from "../scripts/floorView.js";
import { countedTimes, proofVideos, readMovement, runMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import { FLOOR_LEAN, FLOOR_LENS, everyNth, onTheFloor } from "../scripts/replays.js";
import { hopTime } from "../src/index.js";
import { trueHop } from "./helpers/hops.js";
import { VIDEOS } from "./helpers/replays.js";

const SQUAT = readMovement("squat");
const floor = (v: Video): Video => ({ ...v, frames: onTheFloor(FLOOR_LENS, FLOOR_LEAN)(v.frames) });
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v.video;
};
/** The reps whose hop would not lie wholly inside the video: never hopped. */
const unhopped = (video: Video, metres: number, offset: number): number => {
  const last = video.frames[video.frames.length - 1]?.t ?? 0;
  return countedTimes(SQUAT, video).filter((r) => r.end + offset + hopTime(metres) > last).length;
};

describe("the worst thing: a jump seen by a phone on the floor is never counted as a squat", () => {
  // The three squat videos of 52a-ii-a's jumps: side on, in between with no pause between reps, from the front.
  it.each(["squat_reference", "prisoner_squat_3", "sumo_squat_2a"])("%s: jumps of 8, 10 and 12 cm at five take-off times, seen from the floor as filmed and at 8 a second, count only reps they never reached", (label) => {
    const video = videoOf(label);
    for (const metres of [0.08, 0.1, 0.12]) {
      for (const offset of [-200, -100, 0, 100, 200]) {
        const seen = floor(trueHop(video, metres, offset));
        const most = unhopped(video, metres, offset);
        for (const [name, v] of [["as filmed", seen], ["8 a second", { ...seen, frames: everyNth(8)(seen.frames) }]] as const) {
          const count = runMovement(SQUAT, v).count;
          expect([metres, offset, name, count, count <= most]).toEqual([metres, offset, name, count, true]);
        }
      }
    }
  });

  it("the same videos, not jumped, count their squats from the floor: the rows above prove something", () => {
    for (const label of ["squat_reference", "prisoner_squat_3", "sumo_squat_2a"]) {
      const reps = MOVEMENT_VIDEOS.find((e) => e.file.endsWith(`/${label}`))?.reps;
      expect([label, runMovement(SQUAT, floor(videoOf(label))).count]).toEqual([label, reps]);
    }
  });
});

describe("how a man's own floor phone stood, measured from his videos", () => {
  it("leaned back 6.3 degrees in one of his six upright floor videos and 12.6 to 14.5 in the five others; the replay's 14 is their middle", () => {
    const leans = ["floor_phone_test", "usual_v02", "usual_v04", "usual_v05", "usual_v08", "usual_v09"].map((label) => {
      const kept = readKept(new Uint8Array(readFileSync(join(import.meta.dirname, "movement-points", `${label}.bodypoints`))));
      return Math.round((phoneLean(kept.frames)?.degrees ?? Number.NaN) * 10) / 10;
    });
    expect(leans).toEqual([6.3, 14.3, 14.4, 14.5, 12.6, 13.7]);
    const sorted = [...leans].sort((a, b) => a - b);
    expect(((sorted[2] ?? 0) + (sorted[3] ?? 0)) / 2).toBeCloseTo(FLOOR_LEAN, 1);
  });
});

describe("the redraw is kept only because his raised squats, redrawn, read as his real floor squats do", () => {
  it("leaning back 14 degrees: every squat counted, and the feet and the hips read as from his real floor phone", () => {
    const f = faithful(FLOOR_LEAN);
    expect(f.real.map((s) => s.label)).toEqual(["floor_phone_test 0-12 s", "floor_phone_test 13.9-21.1 s", "floor_phone_test 22.3-31.4 s", "usual_v04 9.8-23.2 s"]);
    expect(f.redrawn.map((s) => [s.count, s.reps, s.short])).toEqual(Array.from({ length: 5 }, () => [2, 2, 0]));
    expect(f.rows.filter((r) => r.judged).map((r) => [r.reading, r.within])).toEqual([
      ["feet stay down", true],
      ["feet stay in place", true],
      ["hips, picture against 3D", true],
      ["hips, picture against 3D, standing", true],
    ]);
    expect(f.passes).toBe(true);
    // The redraw moved his raised squats' feet the way his floor phone reads them: "feet stay down" from 1.4 cm towards 2.4.
    const down = f.rows.find((r) => r.reading === "feet stay down");
    expect(down !== undefined && down.redrawn > down.filmed).toBe(true);
  });

  it("leaning back 6.5 degrees, as his first floor video's phone did, it does not: the hips' picture and 3D stand further apart than on any real floor squat of his, and it is not used", () => {
    const f = faithful(6.5);
    expect(f.counts).toBe(true);
    expect(f.rows.filter((r) => r.judged && !r.within).map((r) => r.reading)).toEqual(["hips, picture against 3D"]);
    expect(f.passes).toBe(false);
  });

  it("from 12.5 to 14 degrees all ten of his raised squats count from the floor; leaning further, some are lost, written for the mend (52a-ii-b-ii-b)", () => {
    const raised = proofVideos(MOVEMENT_VIDEOS.filter((e) => e.file === "movement-points/usual_v11" && e.reps !== null));
    expect(raised).toHaveLength(5);
    const counted = [12.5, 13, 13.5, 14, 14.5, 15].map((lean) => [lean, raised.reduce((n, v) => n + runMovement(SQUAT, { ...v.video, frames: onTheFloor(FLOOR_LENS, lean)(v.video.frames) }).count, 0)]);
    expect(counted).toEqual([
      [12.5, 10],
      [13, 10],
      [13.5, 10],
      [14, 10],
      [14.5, 8],
      [15, 9],
    ]);
  });
});

describe("what a phone on the floor sees of each kind of position: his eleven other videos as filmed", () => {
  const rows = positionsTable();

  it("has the eleven, eight of them filmed from the floor", () => {
    expect(rows.map((r) => r.label)).toEqual(["usual_v02", "usual_v03", "usual_v05", "usual_v06", "usual_v07", "usual_v08", "usual_v09", "usual_v10", "usual_v12", "usual_v13", "usual_v14"]);
    expect(rows.filter((r) => r.floor)).toHaveLength(8);
    expect(rows.every((r) => r.found >= 85)).toBe(true);
  });

  it("sitting cross-legged, on all fours and lying, the floor phone sees one ankle in 29, 61 and 91 of 100 found pictures", () => {
    const ankles = (label: string): number => rows.find((r) => r.label === label)?.parts.find((p) => p.part === "ankles")?.one ?? -1;
    expect([ankles("usual_v05"), ankles("usual_v06"), ankles("usual_v07")]).toEqual([29, 61, 91]);
  });
});
