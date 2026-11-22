// The movement matcher and the squat's proof table (ROADMAP 52a; spec Part 2 §12.3, §12.5). The worst thing it could
// do to a person: count a rep nobody did, which then goes to their records and the boards. So the first tests are
// every other movement Kd's folders hold, which must count 0 with the squat's own numbers AND with every set of
// numbers made with one person left out, and real squats turned by hand into something else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { movementSchema, type MovementFrame } from "@app/shared";
import { MovementMatcher, PROMISED_JUMP, checkMovement, hopTime, parseMovement } from "../src/index.js";
import { runChecks, runSteady, type Video } from "../scripts/bodyCheck.js";
import { runMeasures } from "../scripts/measureCheck.js";
import { LEAD_IN, MOVEMENTS, fit, proofTable, proofVideos, readMovement, runMovement, withLeadIn, withNumbers } from "../scripts/movementCheck.js";
import { copy, editPeople } from "./helpers/body.js";
import { FEET, hoppedAt, sizeOf, trueHop } from "./helpers/hops.js";

const SQUAT = readMovement("squat");
const VIDEOS = proofVideos();
const TABLE = proofTable(SQUAT, VIDEOS);
const row = (label: string) => {
  const r = TABLE.rows.find((x) => x.label === label);
  if (r === undefined) throw new Error(`no video ${label}`);
  return r;
};
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v.video;
};
const edited = (video: Video, frames: readonly MovementFrame[]): Video => ({ ...video, frames });
/** Kd's reference squat with a hop of `height` (picture heights; 0.06 is about 15 cm for her) in the 0.4 s after each
 *  rep comes back up, the points `hidden` (the model not sure of them) while in the air. */
function hopped(height: number, hidden: readonly number[] = []): Video {
  return hoppedAt(videoOf("squat_reference"), height, 0, hidden);
}

/** A video's frames at about `fps` a second: the frame nearest each step. */
function slower(video: Video, fps: number): Video {
  const step = 1000 / fps;
  const out: MovementFrame[] = [];
  let next = video.frames[0]?.t ?? 0;
  for (const f of video.frames) {
    if (f.t + 1e-6 >= next) {
      out.push(f);
      next += step;
    }
  }
  return edited(video, out);
}

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

  it("no other movement is open any more: the kettlebell push press, counted 3 until the depth was set from the squat's form standard, counts 0", () => {
    expect(TABLE.rows.filter((r) => r.entry.open !== undefined).map((r) => [r.label, r.count])).toEqual([]);
    expect(row("fresh_push_press_kettlebell").count).toBe(0);
  });

  it("every set of numbers made with one person left out also counts 0 on every other movement, the push press among them", () => {
    expect(TABLE.folds.length).toBe(9);
    expect(TABLE.worstOther).toBe(0);
  });

  // Her first two reps come back up with room for a hop before the video ends; the third comes back up in the last
  // picture held after it, which no edit reaches, and stays the one counted.
  it.each([0.06, 0.04, 0.03, 0.02])("a real squat turned into a hop of %s of the picture's height (about 15, 10, 7.5 and 5 cm for her) at the top counts only the rep not hopped", (height) => {
    const run = runMovement(SQUAT, hopped(height));
    expect(run.count).toBe(1);
    expect(run.reps.slice(0, 2).map((r) => [r.verdict, r.rule])).toEqual([["other", "feet stay down"], ["other", "feet stay down"]]);
  });

  it.each([0.08, 0.12])("a hop of %s m whose feet flicker out in every 3rd frame in the air counts 0: a flicker keeps the lowest place (the second re-check)", (metres) => {
    const video = videoOf("prisoner_squat_3");
    expect(runMovement(SQUAT, hoppedAt(video, metres * sizeOf(video), 200, FEET, 3)).count).toBe(0);
    expect(runMovement(SQUAT, hoppedAt(video, metres * sizeOf(video), 0, FEET, 3)).count).toBe(0);
  });

  it.each([0.1, 0.12])("reps with no pause between them, a hop of %s m starting 0.2 s before each rep is back, count 0 (round one's re-check)", (metres) => {
    const video = videoOf("prisoner_squat_3");
    const run = runMovement(SQUAT, hoppedAt(video, metres * sizeOf(video), 200));
    expect(run.count).toBe(0);
  });

  it("the limit, written: the feet's number is under the smallest jump never counted (8 cm, movementHops.test.ts)", () => {
    const lift = SQUAT.rules.find((r) => r.name === "feet stay down")?.atMost ?? 1;
    expect(lift).toBeLessThan(0.08);
    expect(PROMISED_JUMP).toBe(0.1);
    // That no break hides a 10 cm jump is shown by running the jumps: movementHopsHidden.test.ts.
  });

  it.each([
    ["the feet hidden while in the air", FEET],
    ["the heels and toes hidden while in the air", [29, 30, 31, 32]],
    ["the whole body hidden while in the air", Array.from({ length: 33 }, (_, i) => i)],
  ] as const)("a jump at the top of a rep with %s is never counted: what decides it was not seen", (_name, hidden) => {
    const run = runMovement(SQUAT, hopped(0.06, hidden));
    expect(run.count).toBe(1);
    expect(run.reps.slice(0, 2).every((r) => r.verdict === "unseen" || r.verdict === "other")).toBe(true);
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
    const run = runMovement(SQUAT, edited(video, frames));
    expect(run.count).toBe(0);
    // Every rep as deep as a squat is refused because the feet moved; a dip that never tried may be refused sooner.
    const depth = SQUAT.rules.find((r) => r.name === "depth")?.atLeast ?? 0;
    const deep = run.reps.filter((r) => (r.readings["depth"] ?? 0) >= depth);
    expect(deep.length).toBe(3);
    expect(deep.map((r) => [r.verdict, r.rule])).toEqual(deep.map(() => ["other", "feet stay in place"]));
  });

  it("no other movement is given a word as filmed, but the one written on its video: nothing short, nothing said", () => {
    // Round one: every word counted, what the camera could not see included (under some replays an unseen dip speaks:
    // movementReplaysOthers1 and 2).
    for (const r of others.filter((x) => x.entry.told === undefined)) {
      expect([r.label, r.reps.filter((x) => x.verdict === "short" || x.reason !== null).map((x) => x.reason)]).toEqual([r.label, []]);
    }
  });

  it("the one told: the push press's dips, a quarter squat to the camera, are told to go lower as a quarter squat is, and none counts", () => {
    const told = others.filter((r) => r.entry.told !== undefined);
    expect(told.map((r) => r.label)).toEqual(["fresh_push_press_kettlebell"]);
    for (const r of told) {
      expect(r.count).toBe(0);
      expect([...new Set(r.reps.filter((x) => x.verdict === "short").map((x) => `${x.rule ?? ""}: ${x.reason ?? ""}`))]).toEqual(["knees bent: Go lower to count."]);
    }
  });
});

describe("the squat's own videos count what a person counts by eye", () => {
  const own = TABLE.rows.filter((r) => r.entry.movement === "squat" && r.sets);

  it("nine people set its numbers: side on, from the front and in between, a phone on the floor among them", () => {
    expect(new Set(own.map((r) => r.entry.person)).size).toBe(9);
    expect(new Set(own.map((r) => r.entry.view))).toEqual(new Set(["side", "front", "between"]));
    expect(own.some((r) => r.label.startsWith("floor_phone_test"))).toBe(true);
  });

  it.each(own.map((r) => [r.label, r] as const))("%s, with the squat's numbers and with that person left out of them", (_label, r) => {
    expect([r.count, r.leftOut]).toEqual([r.entry.reps, r.entry.leftOutOpen?.count ?? r.entry.reps]);
  });

  it("the counts wrong with their person left out stay in the table in plain sight, the job that closes each named", () => {
    const open = TABLE.rows.filter((r) => r.entry.leftOutOpen !== undefined);
    expect(open.map((r) => [r.label, r.count, r.leftOut])).toEqual([["floor_phone_test 0-12 s", 3, 2]]);
    expect(open.every((r) => /^53, /.test(r.entry.leftOutOpen?.why ?? ""))).toBe(true);
  });

  it("the shallowest man of the nine counts his 3 with his own videos left out: the depth is set from the form standard, never from him", () => {
    // Until 52b-i the depth was a quarter of the way back from the shallowest person's rep, so without him it rose to 0.23,
    // over his first rep (0.226 of a leg).
    expect([row("prisoner_squat_2").count, row("prisoner_squat_2").leftOut]).toEqual([3, 3]);
    for (const fold of TABLE.folds) expect([fold.person, fold.fitted.find((f) => f.rule === "depth")?.bound]).toEqual([fold.person, 0.16]);
  });

  it.each(TABLE.rows.filter((r) => r.entry.movement === "squat" && !r.sets && r.entry.reps !== null && r.entry.open === undefined).map((r) => [r.label, r] as const))(
    "%s, a twin of the squat that sets no number, counts what a person counts, with every set of numbers",
    (_label, r) => {
      expect(r.count).toBe(r.entry.reps);
      const video = videoOf(r.label);
      // With its own person left out of the numbers, a known wrong count is written on the video (`leftOutOpen`).
      for (const fold of TABLE.folds) {
        const reps = fold.person === r.entry.person ? (r.entry.leftOutOpen?.count ?? r.entry.reps) : r.entry.reps;
        expect([fold.person, runMovement(withNumbers(SQUAT, fold.fitted), video).count]).toEqual([fold.person, reps]);
      }
    },
  );

  it.each([7.5, 8, 10])("at %s frames a second, the slowest the phone gives, each person counts the same", (fps) => {
    for (const label of ["squat_reference", "prisoner_squat_1", "prisoner_squat_3", "sumo_squat_2b"]) {
      expect([label, runMovement(SQUAT, slower(videoOf(label), fps)).count]).toEqual([label, row(label).entry.reps]);
    }
  });

  it("no rep of a squat video is called short or unseen; what is not counted is a small dip, silent, never as deep as a rep", () => {
    const depth = SQUAT.rules.find((x) => x.name === "depth")?.atLeast ?? 0;
    for (const r of own) {
      expect(r.reps.filter((x) => x.verdict === "counted").length).toBe(r.entry.reps);
      for (const x of r.reps.filter((y) => y.verdict !== "counted")) {
        expect([r.label, x.verdict]).toEqual([r.label, "other"]);
        expect(x.readings["depth"]).not.toBeNull();
        expect(x.readings["depth"] ?? depth).toBeLessThan(depth);
      }
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
    expect(run.reps.filter((r) => r.verdict === "unseen").map((r) => [r.rule, r.reason])).toEqual([["depth", "Keep your whole body in view."]]);
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

  it("a break in the feet's readings decides nothing only once it could hold the top of a 10 cm jump", () => {
    const lift = SQUAT.rules.find((r) => r.name === "feet stay down")?.atMost ?? 0;
    // 2·√(2h/g) of the promise less the number and a centimetre of room: 5 cm, 202 ms.
    expect(hopTime(0.05)).toBeGreaterThan(201);
    expect(hopTime(0.05)).toBeLessThan(203);
    expect(hopTime(lift)).toBeCloseTo(2000 * Math.sqrt((2 * lift) / 9.81), 6);
    const video = videoOf("squat_reference");
    const reps = repTimes(video);
    expect(reps.length).toBe(3);
    // The feet hidden after each of the first two reps' tops, no hop, in pictures that came: a short break keeps the
    // count, a long one leaves those reps unseen.
    const hiddenFor = (ms: number): Video =>
      edited(
        video,
        editPeople(video.frames, (p, f) =>
          reps.slice(0, 2).some((r) => f.t >= r.end && f.t < r.end + ms) ? { ...p, points: p.points.map(([x, y, z, v, pr], i) => [x, y, z, FEET.includes(i) ? 0.1 : v, pr]) } : p,
        ),
      );
    expect(runMovement(SQUAT, hiddenFor(60)).count).toBe(3);
    // Seven pictures hidden: a break of 267 ms.
    const long = runMovement(SQUAT, hiddenFor(220));
    expect(long.count).toBe(1);
    expect(long.reps.filter((r) => r.verdict === "unseen").map((r) => [r.rule, r.reason])).toEqual([
      ["feet stay down", "Keep your whole body in view."],
      ["feet stay down", "Keep your whole body in view."],
    ]);
  });

  it("pictures the phone did not send leave a break judged as any other: the body may be in the air then too", () => {
    const video = videoOf("squat_reference");
    const reps = repTimes(video);
    // No picture at all for a while after each of the first two reps' tops: the phone was busy.
    const unsentFor = (ms: number): Video => edited(video, video.frames.filter((f) => !reps.slice(0, 2).some((r) => f.t >= r.end && f.t < r.end + ms)));
    expect(runMovement(SQUAT, unsentFor(100)).count).toBe(3);
    const long = runMovement(SQUAT, unsentFor(240));
    expect(long.count).toBe(1);
    expect(long.reps.filter((r) => r.verdict === "unseen").map((r) => r.rule)).toEqual(["feet stay down", "feet stay down"]);
  });

  it("a real rep whose feet flicker out at the moment it would be judged waits for them and counts", () => {
    // The feet hidden from 0.38 s to 0.43 s after each of the first two reps is back, across the 0.4 s it is judged at.
    const video = videoOf("squat_reference");
    const reps = repTimes(video);
    const frames = editPeople(video.frames, (p, f) =>
      reps.slice(0, 2).some((r) => f.t >= r.end + 380 && f.t < r.end + 430) ? { ...p, points: p.points.map(([x, y, z, v, pr], i) => [x, y, z, FEET.includes(i) ? 0.1 : v, pr]) } : p,
    );
    expect(runMovement(SQUAT, edited(video, frames)).count).toBe(3);
  });

  it("a rep is not judged while its feet are hidden at the moment it would be: it waits, and a jump hidden then is seen", () => {
    // The feet hidden from 0.35 s to 0.45 s after each of the first two reps is back, across the moment the rep would
    // be judged (0.4 s), with a 10 cm jump taking off at 0.3 s: counted, the rep would hide the jump's top.
    const video = videoOf("prisoner_squat_3");
    const run = runMovement(SQUAT, trueHop(video, 0.1, 300, Object.fromEntries(FEET.map((k) => [k, [50, 150] as const]))));
    // Her fifth rep's jump would take off after the video ends: only that rep is never jumped.
    expect(run.reps.filter((r) => r.verdict === "counted").map((r) => Math.round((r.start - LEAD_IN) / 100) / 10)).toEqual([Math.round((repTimes(video)[4]?.start ?? 0) / 100) / 10]);
  });

  it("a toe the model slides down the picture at the bottom is not a foot off the floor while its heel stays down", () => {
    // As on the fresh barbell front squat: at the bottom the toe points go 0.02 of the picture (about 4 cm for her) down
    // the picture, and back up to where they were as she stands: the toes rose from their lowest, the heels did not.
    const video = videoOf("squat_reference");
    const reps = repTimes(video);
    const TOES = [31, 32];
    const frames = editPeople(video.frames, (p, f) => {
      const r = reps.find((x) => f.t >= x.start && f.t <= x.end);
      if (r === undefined) return p;
      const bottom = (r.start + r.end) / 2;
      const slide = 0.02 * Math.max(0, 1 - Math.abs(f.t - bottom) / ((r.end - r.start) / 2));
      return { ...p, points: p.points.map(([x, y, z, v, pr], i) => [x, TOES.includes(i) ? y + slide : y, z, v, pr]) };
    });
    expect(runMovement(SQUAT, edited(video, frames)).count).toBe(3);
  });

  it("one frame arriving twice with the same time decides nothing and keeps the count", () => {
    const video = videoOf("squat_reference");
    const second = repTimes(video)[1];
    const at = video.frames.findIndex((f) => second !== undefined && f.t >= second.end + 400);
    const twice = video.frames[at];
    expect(twice).toBeDefined();
    const frames = twice === undefined ? video.frames : [...video.frames.slice(0, at + 1), twice, ...video.frames.slice(at + 1)];
    expect(runMovement(SQUAT, edited(video, frames)).count).toBe(3);
  });

  it("a set ended less than a moment after a rep came back up does not count it: a jump from its top could not show yet", () => {
    // Played as the proof plays it, its first picture held a second, so the first rep is seen from standing.
    const video = withLeadIn(videoOf("squat_reference"));
    const first = runMovement(SQUAT, videoOf("squat_reference")).reps.find((r) => r.verdict === "counted");
    expect(first).toBeDefined();
    const steady = runSteady(runChecks(video.frames));
    const measured = runMeasures(steady);
    for (const [after, counted] of [[100, 0], [500, 1]] as const) {
      const m = new MovementMatcher(SQUAT);
      let count = 0;
      steady.forEach((b, i) => {
        const x = measured[i];
        if (x !== undefined && first !== undefined && b.t <= first.end + after) count = m.next(b, x).count;
      });
      count = m.finish()?.count ?? count;
      expect([after, count]).toEqual([after, counted]);
    }
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
