// The movement matcher and the squat's proof table (ROADMAP 52a; spec Part 2 §12.3, §12.5). The worst thing it could
// do to a person: count a rep nobody did, which then goes to their records and the boards. So the first tests are
// every other movement Kd's folders hold, which must count 0 with the squat's own numbers AND with every set of
// numbers made with one person left out, and real squats turned by hand into something else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { movementSchema, type MovementFrame } from "@app/shared";
import { MovementMatcher, checkMovement, parseMovement } from "../src/index.js";
import { runChecks, runSteady, type Video } from "../scripts/bodyCheck.js";
import { runMeasures } from "../scripts/measureCheck.js";
import { LEAD_IN, MOVEMENTS, fit, proofTable, proofVideos, readMovement, runMovement } from "../scripts/movementCheck.js";
import { copy, editPeople } from "./helpers/body.js";

const SQUAT = readMovement("squat");
const VIDEOS = proofVideos();
const TABLE = proofTable(SQUAT, VIDEOS);
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v.video;
};
const edited = (video: Video, frames: readonly MovementFrame[]): Video => ({ ...video, frames });
/** The squat's counted reps in a video, their times in the video's own clock (the run holds a lead-in first). */
const repTimes = (video: Video) =>
  runMovement(SQUAT, video)
    .reps.filter((r) => r.verdict === "counted")
    .map((r) => ({ start: r.start - LEAD_IN, end: r.end - LEAD_IN }));

describe("the worst thing: no other movement is ever counted as a squat", () => {
  const others = TABLE.rows.filter((r) => r.entry.movement === null);

  it("Kd's folders give many other movements to try, from every side", () => {
    expect(others.length).toBeGreaterThanOrEqual(30);
    expect(new Set(others.map((r) => r.entry.view))).toEqual(new Set(["side", "front", "between"]));
  });

  it.each(others.filter((r) => r.entry.open === undefined).map((r) => [r.label, r] as const))("%s counts 0 with the squat's numbers", (_label, r) => {
    expect(r.count).toBe(0);
  });

  it("the one open case stays in the table in plain sight, its wrong count written: a kettlebell push press's dip", () => {
    const open = others.filter((r) => r.entry.open !== undefined);
    expect(open.map((r) => [r.label, r.count])).toEqual([["fresh_push_press_kettlebell", 2]]);
    expect(open[0]?.entry.open).toMatch(/^52b: /);
  });

  it("every set of numbers made with one person left out also counts 0 on every other movement but the open case", () => {
    expect(TABLE.folds.length).toBe(8);
    expect(TABLE.worstOther).toBe(0);
  });

  it("a real squat turned into a jump at the top of each rep counts 0: the feet left the floor", () => {
    const video = videoOf("squat_reference");
    const reps = repTimes(video);
    expect(reps.length).toBe(3);
    // A hop of about 15 cm (0.06 of the picture's height for her) in the 0.4 s after each rep comes back up.
    const hop = (t: number): number => {
      for (const r of reps) {
        const s = (t - r.end) / 400;
        if (s >= 0 && s <= 1) return 0.06 * 4 * s * (1 - s);
      }
      return 0;
    };
    const frames = editPeople(video.frames, (p, f) => ({ ...p, points: p.points.map(([x, y, z, v, pr]) => [x, y - hop(f.t), z, v, pr]) }));
    const run = runMovement(SQUAT, edited(video, frames));
    expect(run.count).toBe(0);
    expect(run.reps.filter((r) => r.verdict === "other").map((r) => r.rule)).toContain("feet stay down");
  });

  it("a real squat whose feet move out wide at the bottom, and back, counts 0 from the front: the stance changed", () => {
    const video = videoOf("prisoner_squat_1");
    const reps = repTimes(video);
    expect(reps.length).toBe(3);
    // Each foot carried 12 cm out on the picture (0.05 of its width at her size) around the bottom of each rep, as a
    // squat jack's feet go; legs, knees and hips carried with them so no bone changes length on the picture.
    const LEFT_LEG = [25, 27, 29, 31];
    const RIGHT_LEG = [26, 28, 30, 32];
    const out = (t: number): number => {
      for (const r of reps) {
        const mid = (r.start + r.end) / 2;
        const s = 1 - Math.abs(t - mid) / ((r.end - r.start) / 2);
        if (s > 0) return 0.05 * Math.min(1, s * 2);
      }
      return 0;
    };
    const frames = editPeople(video.frames, (p, f) => {
      const dx = out(f.t);
      const q = copy(p);
      return {
        ...q,
        points: q.points.map(([x, y, z, v, pr], i) => [LEFT_LEG.includes(i) ? x + dx : RIGHT_LEG.includes(i) ? x - dx : x, y, z, v, pr]),
      };
    });
    expect(runMovement(SQUAT, edited(video, frames)).count).toBe(0);
  });
});

describe("the squat's own videos count what a person counts by eye", () => {
  const own = TABLE.rows.filter((r) => r.entry.movement === "squat" && r.sets);

  it("eight people set its numbers: side on, from the front and in between", () => {
    expect(new Set(own.map((r) => r.entry.person)).size).toBe(8);
    expect(new Set(own.map((r) => r.entry.view))).toEqual(new Set(["side", "front", "between"]));
  });

  it.each(own.map((r) => [r.label, r] as const))("%s, with the squat's numbers and with that person left out of them", (_label, r) => {
    expect([r.count, r.leftOut]).toEqual([r.entry.reps, r.entry.reps]);
  });

  it.each(TABLE.rows.filter((r) => r.entry.movement === "squat" && !r.sets && r.entry.reps !== null).map((r) => [r.label, r] as const))(
    "%s, a twin of the squat that sets no number, counts what a person counts",
    (_label, r) => {
      expect(r.count).toBe(r.entry.reps);
    },
  );

  it("no rep of a squat video is called another movement or short, except the dips between reps that are not reps", () => {
    for (const r of own) {
      const counted = r.reps.filter((x) => x.verdict === "counted").length;
      expect(counted).toBe(r.entry.reps);
      // Whatever else it found are small dips: none went as deep as the squat's own depth.
      const depth = SQUAT.rules.find((x) => x.name === "depth")?.atLeast ?? 0;
      for (const x of r.reps.filter((y) => y.verdict !== "counted")) expect(x.readings["depth"] ?? 0).toBeLessThan(depth);
    }
  });

  it("the numbers in movements/squat.json are the ones movement-check sets from the videos today", () => {
    const fitted = fit(SQUAT, VIDEOS.filter((v) => v.entry.movement === "squat" && v.video.sets));
    for (const f of fitted) {
      const rule = SQUAT.rules.find((r) => r.name === f.rule);
      expect([f.rule, rule?.atLeast ?? rule?.atMost]).toEqual([f.rule, f.bound]);
    }
  });
});

describe("the camera must see enough, or nothing is decided", () => {
  it("a rep whose person is hidden for 0.6 s at the bottom decides nothing: not counted, and said as unseen", () => {
    const video = videoOf("squat_reference");
    const reps = repTimes(video);
    const second = reps[1];
    expect(second).toBeDefined();
    const mid = second === undefined ? 0 : (second.start + second.end) / 2;
    const frames = editPeople(video.frames, (p, f) =>
      Math.abs(f.t - mid) <= 300 ? { ...p, points: p.points.map(([x, y, z, , pr]) => [x, y, z, 0.1, pr]) } : p,
    );
    const run = runMovement(SQUAT, edited(video, frames));
    expect(run.count).toBe(2);
    expect(run.reps.some((r) => r.verdict === "unseen")).toBe(true);
  });

  it("a rep whose shoulders are hidden throughout, the hips and feet seen, decides nothing: the trunk could not be judged", () => {
    const video = videoOf("squat_reference");
    const second = repTimes(video)[1];
    expect(second).toBeDefined();
    const [from, to] = second === undefined ? [0, 0] : [second.start - 300, second.end + 300];
    // The shoulders and everything that hangs from them: the arms and hands.
    const UPPER = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const frames = editPeople(video.frames, (p, f) =>
      f.t >= from && f.t <= to ? { ...p, points: p.points.map(([x, y, z, v, pr], i) => [x, y, z, UPPER.includes(i) ? 0.1 : v, pr]) } : p,
    );
    const run = runMovement(SQUAT, edited(video, frames));
    expect(run.count).toBe(2);
    const judged = run.reps.find((r) => r.verdict === "unseen");
    expect(judged?.rule).toMatch(/hips and knees together|chest up/);
  });

  it("frames with nobody in them count nothing and leave the matcher waiting", () => {
    const video = videoOf("squat_reference");
    const empty = video.frames.map((f): MovementFrame => ({ ...f, people: [] }));
    const steady = runSteady(runChecks(empty));
    const measured = runMeasures(steady);
    const m = new MovementMatcher(SQUAT);
    const frames = steady.map((b, i) => {
      const x = measured[i];
      if (x === undefined) throw new Error("a frame was not measured");
      return m.next(b, x);
    });
    expect(frames.every((f) => f.count === 0 && f.state === "waiting" && f.rep === null)).toBe(true);
    expect(m.finish()).toBeNull();
  });

  it("a clock that goes back starts afresh: what was counted before is not carried into a new person", () => {
    const video = videoOf("squat_reference");
    const steady = runSteady(runChecks(video.frames));
    const measured = runMeasures(steady);
    const m = new MovementMatcher(SQUAT);
    let count = 0;
    steady.forEach((b, i) => {
      const x = measured[i];
      if (x !== undefined) count = m.next(b, x).count;
    });
    expect(count).toBeGreaterThan(0);
    const first = steady[0];
    const firstMeasured = measured[0];
    if (first === undefined || firstMeasured === undefined) throw new Error("no first frame");
    expect(m.next(first, firstMeasured)).toMatchObject({ state: "waiting", count: 0 });
  });
});

describe("a movement file is parsed before the engine trusts it", () => {
  const json = (): unknown => JSON.parse(readFileSync(join(MOVEMENTS, "squat.json"), "utf8"));

  it("the squat's own file parses, and every number in it says where it came from", () => {
    const m = parseMovement(json());
    expect(m.rules.every((r) => r.from.length > 20)).toBe(true);
    expect(m.ready.every((r) => r.from.length > 20)).toBe(true);
  });

  it("refuses a measure the engine does not have", () => {
    expect(() => parseMovement({ ...SQUAT, drive: { measure: "hip height", toward: "lower" } })).toThrow(/does not have: hip height/);
    expect(() => parseMovement({ ...SQUAT, rules: SQUAT.rules.map((r, i) => (i === 3 ? { ...r, read: { kind: "value", measures: ["chest"] } } : r)) })).toThrow(/does not have: chest/);
    expect(() => {
      checkMovement(SQUAT);
    }).not.toThrow();
  });

  it("refuses a rep movement with no depth to count by, a rule with two bounds, and two rules of one name", () => {
    expect(movementSchema.safeParse({ ...SQUAT, rules: SQUAT.rules.filter((r) => r.name !== "depth") }).success).toBe(false);
    expect(movementSchema.safeParse({ ...SQUAT, rules: SQUAT.rules.map((r, i) => (i === 1 ? { ...r, atLeast: 1, atMost: 2 } : r)) }).success).toBe(false);
    expect(movementSchema.safeParse({ ...SQUAT, rules: [...SQUAT.rules, SQUAT.rules[1]] }).success).toBe(false);
    expect(movementSchema.safeParse(json()).success).toBe(true);
  });
});
