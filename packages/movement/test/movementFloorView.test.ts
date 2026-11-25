// A phone standing on the floor, every proof video redrawn as it would see them (ROADMAP 52a-ii-b-ii-a; spec Part 2
// §12.5 "As built, the floor view"). The worst thing this job could do to a person: a floor view that does not look as a
// real floor phone looks would prove that an exercise counts from the floor when it does not, and a member's proper reps
// would go uncounted, or a jump be counted. So first: jumps seen through the redraw; then it is held as proof only if a
// man's own squats from a raised phone, redrawn, read as his real floor squats do. As measured they do not yet, at any
// of his six leans: the replay is shown, not held, and this file pins what each lean gives. 52a-ii-b-ii-b-i added the
// pose model's own foot wander measured on his floor sets, and pins that with it squats his real floor counts are lost
// and the floor view still does not read as his floor.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Video } from "../scripts/bodyCheck.js";
import { readKept } from "../scripts/bodyCheck.js";
import { JUDGED, faithful, phoneLean, positionsTable } from "../scripts/floorView.js";
import { countedTimes, holds, proofVideos, readMovement, replayTable, runMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import { FLOOR_LEAN, FLOOR_LEANS_MEASURED, FLOOR_LENS, LENS_MM, REPLAYS, everyNth, floorSquatSets, floorWander, onTheFloor, wanderOf, wanderSpread } from "../scripts/replays.js";
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
/** Every jump of 8, 10 and 12 cm at five take-off times on a video, redrawn from the floor, as filmed and at 8 a second:
 *  the cases counting a rep nobody did, as "metres | offset | seen | how many". */
function jumpsCounted(video: Video): string[] {
  return [0.08, 0.1, 0.12].flatMap((metres) =>
    [-200, -100, 0, 100, 200].flatMap((offset) => {
      const seen = floor(trueHop(video, metres, offset));
      const most = unhopped(video, metres, offset);
      const ways: readonly (readonly [string, Video])[] = [
        ["as filmed", seen],
        ["8 a second", { ...seen, frames: everyNth(8)(seen.frames) }],
      ];
      return ways.flatMap(([name, v]) => {
        const extra = runMovement(SQUAT, v).count - most;
        return extra > 0 ? [`${String(metres)} | ${String(offset)} | ${name} | ${String(extra)}`] : [];
      });
    }),
  );
}

describe("the worst thing: the floor view held as proof while it does not read as a real floor phone reads", () => {
  // 52a-ii-b-ii-b-i. A floor view that is proof without reading as a real floor phone reads would say an exercise counts
  // from the floor when it does not. The pose model's own foot wander, measured on his floor sets and added to the
  // redraw in step with his knees, is tried with each floor set left out in turn: in no fold does it read as his floor
  // squats do, so the floor view stays shown.
  const replay = REPLAYS.find((r) => r.name === "on the floor");
  const floorSets = floorSquatSets().floor;

  it("his five floor sets are the five the floor view is judged against (his dull floor's two since 52a-ii-b-ii-b-ii, where he turns round)", () => {
    expect(floorSets).toEqual(["floor_phone_test 0-12 s", "floor_phone_test 13.9-21.1 s", "floor_phone_test 22.3-31.4 s", "usual_v04 9.8-17.5 s", "usual_v04 19.2-23.2 s"]);
  });

  it.each([
    // Since 52d-i his floor sets are read through the lock, which takes him afresh where he is found again after walking
    // back from the phone unseen: his standing hips read nearer the redraw's (scripts/movementVideos.ts, the spec's 52d-i).
    ["floor_phone_test 0-12 s", 7, ["feet stay in place"], 0.041],
    ["floor_phone_test 13.9-21.1 s", 7, ["feet stay down"], 0.032],
    ["floor_phone_test 22.3-31.4 s", 8, ["feet stay down", "hips, picture against 3D, standing"], 0.033],
    ["usual_v04 9.8-17.5 s", 9, ["feet stay in place", "hips, picture against 3D"], 0.037],
    ["usual_v04 19.2-23.2 s", 7, ["feet stay in place"], 0.044],
  ] as const)("the wander measured without %s: %s of his 10 raised squats counted from the floor; short of his floor: %j; feet stay in place %s; the floor view is not held", (left, counted, failing, travel) => {
    const f = faithful(FLOOR_LEAN, LENS_MM, undefined, floorSets.filter((s) => s !== left));
    expect(f.redrawn.reduce((n, s) => n + s.count, 0)).toBe(counted);
    expect(f.rows.filter((r) => r.judged && !r.within).map((r) => r.reading)).toEqual(failing);
    expect(Math.round((f.rows.find((r) => r.reading === "feet stay in place")?.redrawn ?? 0) * 1000) / 1000).toBe(travel);
    expect(f.passes).toBe(false);
    expect(replay?.hold).toBe(false);
  });
});

describe("the worst thing, as 52a-ii-b-ii-a first wrote it: a jump drawn on a squat video, seen through the floor redraw: what counts", () => {
  // The three squat videos of 52a-ii-a's jumps: side on, in between with no pause between reps, from the front.
  it.each(["squat_reference", "prisoner_squat_3", "sumo_squat_2a"])("%s: jumps of 8, 10 and 12 cm at five take-off times, seen from the floor as filmed and at 8 a second, count only reps they never reached", (label) => {
    expect(jumpsCounted(videoOf(label))).toEqual([]);
  });

  it("the same videos, not jumped, count their squats from the floor: the rows above prove something", () => {
    for (const label of ["squat_reference", "prisoner_squat_3", "sumo_squat_2a"]) {
      const reps = MOVEMENT_VIDEOS.find((e) => e.file.endsWith(`/${label}`))?.reps;
      expect([label, runMovement(SQUAT, floor(videoOf(label))).count]).toEqual([label, reps]);
    }
  });

  it("on his five raised sets, 3 of 150 count from the floor, every one a case the raised phone refuses (from the raised phone itself none; 14 from the floor until 52a-ii-b-ii-b-ii, 4 until 52b-i), in plain sight: the floor view is shown, never proof", () => {
    const raised = proofVideos(MOVEMENT_VIDEOS.filter((e) => e.file === "movement-points/usual_v11" && e.reps !== null));
    expect(raised.map((v) => [v.video.label, jumpsCounted(v.video)])).toEqual([
      ["usual_v11 1.3-7.4 s", []],
      ["usual_v11 8.3-14.2 s", []],
      ["usual_v11 15.3-21.6 s", []],
      ["usual_v11 22-29.5 s", ["0.08 | 200 | 8 a second | 1"]],
      ["usual_v11 30-39 s", ["0.08 | -200 | as filmed | 1", "0.08 | -200 | 8 a second | 1"]],
    ]);
  });
});

describe("how a man's own floor phone stood, measured from his videos", () => {
  it("leaned back 6.4 degrees in one of his six upright floor videos and 12.6 to 14.5 in the five others; the replay's 14 is their middle", () => {
    const leans = ["floor_phone_test", "usual_v02", "usual_v04", "usual_v05", "usual_v08", "usual_v09"].map((label) => {
      const kept = readKept(new Uint8Array(readFileSync(join(import.meta.dirname, "movement-points", `${label}.bodypoints`))));
      return Math.round((phoneLean(kept.frames)?.degrees ?? Number.NaN) * 10) / 10;
    });
    expect(leans).toEqual([6.4, 14.3, 14.4, 14.5, 12.6, 13.7]);
    const sorted = [...leans].sort((a, b) => a - b);
    expect(((sorted[2] ?? 0) + (sorted[3] ?? 0)) / 2).toBeCloseTo(FLOOR_LEAN, 1);
  });
});

describe("his raised squats, redrawn from the floor, do not yet read as his real floor squats do: the floor view is shown, never held", () => {
  it("is shown, not held: no squat's proof, no other movement's, and no number rests on it", () => {
    const replay = REPLAYS.find((r) => r.name === "on the floor");
    expect([replay?.hold, replay?.fits]).toEqual([false, false]);
  });

  // At each of his six leans (his first video's as measured, 6.4, and as first measured, 6.5), and at the replay's 14: how
  // many of his ten raised squats count, and which of the four readings the redraw does not take far enough.
  it.each([
    [6.4, 9, ["feet stay down", "hips, picture against 3D", "hips, picture against 3D, standing"]],
    [6.5, 9, ["feet stay down", "hips, picture against 3D", "hips, picture against 3D, standing"]],
    // Since 52d-i his standing hips, read through the lock, are within reach at these leans: "feet stay down" alone falls short.
    [12.6, 10, ["feet stay down"]],
    [13.7, 10, ["feet stay down"]],
    [FLOOR_LEAN, 10, ["feet stay down"]],
    // At 14.3 to 14.5 degrees one squat of his pair at 22 s was lost until 52b-i: a rep begun while he still stood,
    // before he moved, took his settling feet in; a rep no longer begins while the person stands tall.
    [14.3, 10, ["feet stay down"]],
    [14.4, 10, ["feet stay down"]],
    [14.5, 10, ["feet stay down"]],
  ] as const)("leaning back %s degrees: %s of 10 counted; short of his floor: %j", (lean, counted, failing) => {
    const f = faithful(lean);
    expect(f.real.map((s) => s.label)).toEqual(["floor_phone_test 0-12 s", "floor_phone_test 13.9-21.1 s", "floor_phone_test 22.3-31.4 s", "usual_v04 9.8-17.5 s", "usual_v04 19.2-23.2 s"]);
    expect(f.redrawn.reduce((n, s) => n + s.count, 0)).toBe(counted);
    expect(f.redrawn.every((s) => s.short === 0)).toBe(true);
    expect(f.rows.filter((r) => r.judged && !r.within).map((r) => r.reading)).toEqual(failing);
    expect(f.passes).toBe(false);
  });

  it("at the replay's lean three of the four readings it judges move from his raised phone's towards his floor's; the hips below standing go past it (with his dull floor's two sets, 52a-ii-b-ii-b-ii)", () => {
    const f = faithful(FLOOR_LEAN);
    expect(
      JUDGED.map((name) => {
        const r = f.rows.find((x) => x.reading === name);
        if (r === undefined) throw new Error(name);
        return [name, Math.abs(r.redrawn - r.floor) < Math.abs(r.filmed - r.floor)];
      }),
    ).toEqual([
      ["feet stay down", true],
      ["feet stay in place", true],
      ["hips, picture against 3D", false],
      ["hips, picture against 3D, standing", true],
    ]);
  });

  it("every one of his six leans is tried", () => {
    expect(FLOOR_LEANS_MEASURED).toEqual([6.4, 12.6, 13.7, 14.3, 14.4, 14.5]);
  });
});

describe("the pose model's own foot wander near the floor, measured on his floor sets and added, loses squats his real floor counts and does not read as his floor (52a-ii-b-ii-b-i)", () => {
  const sets = floorSquatSets();

  it("is the model's own: while his knees are straight around a squat, no floor set's foot point lies a step (10 cm) from where it stood before that squat", () => {
    // A step or a turn is the person moving, never the model's wander (round one: on his dull floor he turned round
    // between his second and third squats, his heel 35 cm across, and a reference taken over the whole set
    // read that turn as wander).
    // After he turns round on his dull floor (52a-ii-b-ii-b-ii) his left knee reads 149 to 157 degrees in 3D while he
    // stands, so that set has no frame read with both knees straight; taken by the straighter knee alone, its last half
    // second holds him stepping off after his squat, his foot 10 to 17 cm across: him moving, not the model.
    const checked = sets.floor.map((label) => {
      const far = wanderOf(label)
        .filter((f) => f.knees.every((k) => k !== null && k >= 165))
        .flatMap((f) => f.points.flatMap((q) => (q === null ? [] : [Math.hypot(q[0], q[1])])));
      return [label, far.length > 0, far.length === 0 || Math.max(...far) < 0.1];
    });
    expect(checked).toEqual(sets.floor.map((label) => [label, label !== "usual_v04 19.2-23.2 s", true]));
  });

  // From his raised phone 2.5 cm across until 52b-i: one squat of his last raised pair began 0.9 s before he moved, while
  // he stood, so the half second before it, his foot's reference, was not that squat's own standing.
  it("spreads further on his floor than from his raised phone: 3.2 and 3.9 cm across and down against 1.7 and 2.6", () => {
    const cm = (v: readonly [number, number]): number[] => v.map((x) => Math.round(x * 1000) / 10);
    expect([cm(wanderSpread(sets.floor)), cm(wanderSpread(sets.raised))]).toEqual([
      [3.2, 3.9],
      [1.7, 2.6],
    ]);
  });

  it("names only his floor sets: a set it does not know is refused, never read as no wander", () => {
    expect(() => floorWander(["no such set"])).toThrow("not one of his floor sets: no such set");
  });

  // With all five floor sets' wander, at each of his six leans and the replay's: how many of his ten raised squats count
  // (without it 9 at 6.4 and 6.5, 10 at the others) and which judged readings fall short.
  it.each([
    // Since 52d-i, from 12.6 degrees every judged reading is within reach of his floor's, yet 2 of his 10 squats are lost.
    [6.4, 8, ["hips, picture against 3D", "hips, picture against 3D, standing"], 0.025],
    [12.6, 8, [], 0.031],
    [13.7, 8, [], 0.031],
    [FLOOR_LEAN, 8, [], 0.031],
    [14.3, 8, [], 0.033],
    [14.4, 8, [], 0.033],
    [14.5, 8, [], 0.033],
  ] as const)("leaning back %s degrees with the floor's wander: %s of 10 counted; short of his floor: %j; feet stay in place %s", (lean, counted, failing, travel) => {
    const f = faithful(lean, LENS_MM, undefined, null);
    expect(f.redrawn.reduce((n, s) => n + s.count, 0)).toBe(counted);
    expect(f.redrawn.every((s) => s.short === 0)).toBe(true);
    expect(f.rows.filter((r) => r.judged && !r.within).map((r) => r.reading)).toEqual(failing);
    expect(Math.round((f.rows.find((r) => r.reading === "feet stay in place")?.redrawn ?? 0) * 1000) / 1000).toBe(travel);
    expect(f.passes).toBe(false);
  });

  // Taken from one floor set alone: it depends on the set. From his half-turned set every raised squat counts, yet both
  // hips readings fall short; from his side-on set on the shiny floor 4 of 10 count.
  it.each([
    ["floor_phone_test 0-12 s", 3, ["feet stay down", "feet stay in place", "hips, picture against 3D, standing"], 0.082],
    ["floor_phone_test 13.9-21.1 s", 10, ["feet stay down", "hips, picture against 3D"], 0.035],
    ["floor_phone_test 22.3-31.4 s", 5, ["feet stay down"], 0.029],
    ["usual_v04 9.8-17.5 s", 4, ["feet stay in place"], 0.068],
    ["usual_v04 19.2-23.2 s", 3, ["feet stay in place", "hips, picture against 3D"], 0.091],
  ] as const)("the wander from %s alone: %s of 10 counted; short of his floor: %j; feet stay in place %s", (set, counted, failing, travel) => {
    const f = faithful(FLOOR_LEAN, LENS_MM, undefined, [set]);
    expect(f.redrawn.reduce((n, s) => n + s.count, 0)).toBe(counted);
    expect(f.rows.filter((r) => r.judged && !r.within).map((r) => r.reading)).toEqual(failing);
    expect(Math.round((f.rows.find((r) => r.reading === "feet stay in place")?.redrawn ?? 0) * 1000) / 1000).toBe(travel);
    expect(f.passes).toBe(false);
  });

  it("without the wander, the redraw is as 52a-ii-b-ii-a left it: 10 of 10 counted at the replay's lean", () => {
    expect(faithful(FLOOR_LEAN).redrawn.reduce((n, s) => n + s.count, 0)).toBe(10);
  });
});

describe("every proof video seen through the floor view, shown: the numbers the spec gives", () => {
  const replay = REPLAYS.find((r) => r.name === "on the floor");
  if (replay === undefined) throw new Error("no floor replay");

  it("every other movement tried counts 0 and calls nothing short: 84 of its 91 videos, the 7 filmed from the floor not tried", () => {
    // The push press is judged since 52b-i, when it came to count 0: its dips, a quarter squat to the camera, are told to go
    // lower as a quarter squat is (its video says so).
    const rows = replayTable(SQUAT, VIDEOS.filter((v) => v.entry.movement !== "squat"), [replay]);
    // 91 since 52d-i, his sit-and-stand on a chair written open (92 since 52c-ii, its 18 videos of floor work, holds and others
    // not filmed from the floor; 74 since 52c-i).
    expect([rows.length, rows.filter((r) => r.tried).length]).toEqual([91, 84]);
    expect(rows.filter((r) => r.tried && (r.count > 0 || (r.entry.told === undefined && r.reps.some((x) => x.verdict === "short")))).map((r) => r.label)).toEqual([]);
  });

  it("of the 18 squat sets tried, 17 count by eye; the one that does not, as written in the spec", () => {
    // His pair at 22 s with his own videos left out lost a squat until 52b-i (2 and 1).
    const rows = replayTable(SQUAT, VIDEOS.filter((v) => v.entry.movement === "squat"), [replay]).filter((r) => r.tried);
    expect(rows).toHaveLength(18);
    expect(rows.filter((r) => !holds(r)).map((r) => [r.label, r.count, r.leftOut])).toEqual([["fresh_front_squat_barbell", 2, null]]);
  });
});

describe("what a phone on the floor sees of each kind of position: his eleven other videos as filmed", () => {
  const rows = positionsTable();

  it("has the eleven, eight of them filmed from the floor", () => {
    expect(rows.map((r) => r.label)).toEqual(["usual_v02", "usual_v03", "usual_v05", "usual_v06", "usual_v07", "usual_v08", "usual_v09", "usual_v10", "usual_v12", "usual_v13", "usual_v14"]);
    expect(rows.filter((r) => r.floor)).toHaveLength(8);
    expect(rows.every((r) => r.found >= 85)).toBe(true);
  });

  it("sitting cross-legged, on all fours and lying, the floor phone sees one ankle in 29, 60 and 91 of 100 found pictures", () => {
    const ankles = (label: string): number => rows.find((r) => r.label === label)?.parts.find((p) => p.part === "ankles")?.one ?? -1;
    // On all fours 60 since 52d-i (61 before): read through the lock, which takes him afresh as he comes back from the phone.
    expect([ankles("usual_v05"), ankles("usual_v06"), ankles("usual_v07")]).toEqual([29, 60, 91]);
  });
});
