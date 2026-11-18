// The body measures on Kd's six kept videos (ROADMAP 50c-iii): a part pointing at the camera is
// never read on the flat picture; side on, the near side is read flat in every frame and the flat
// reading is the steadier; the squat agrees with Kd's own measuring of it; the same video at half
// the frames a second gets the same answers.
import { describe, expect, it } from "vitest";
import { MEASURE_LIMITS, MEASURE_LIST, type MeasureName } from "../src/index.js";
import { halfRate, runChecks, runSteady, type Video } from "../scripts/bodyCheck.js";
import {
  agreementOf,
  chooseAngleLimit,
  chooseLengthLimit,
  chooseSizeChange,
  framesToDraw,
  kindOf,
  leaveOneOut,
  runMeasures,
  runOf,
  sizeSwings,
  steadierOf,
  summaryOf,
} from "../scripts/measureCheck.js";
import { VIDEOS, outsideVideo } from "./helpers/body.js";

function video(label: string): Video {
  const v = VIDEOS.find((x) => x.label === label);
  if (v === undefined) throw new Error(`no kept video ${label}`);
  return v;
}
const unitOf = (name: MeasureName) => MEASURE_LIST.find((m) => m.name === name)?.unit ?? "degrees";

describe("the worst thing: the lying man's trunk, seen from the head end of the bench", () => {
  // On this clip the trunk points at the camera: read flat it is anything from 44° to 178°.
  const measured = runOf(video("dumbbell_bench_press_reference_head_end")).measured;
  const trunk = measured.map((m) => m.readings.get("trunk lean")).filter((r) => r !== undefined && r.world !== null);

  it("is refused on the flat picture in at least 98 frames of 100 where it is read in 3D", () => {
    expect(trunk.length).toBeGreaterThan(250);
    const flat = trunk.filter((r) => r?.flat !== null).length;
    // Measured: 2 of 321, both lying (110° and 111° flat, 103° in 3D, the picture showing 0.55
    // and 0.53 of the trunk).
    expect(flat / trunk.length).toBeLessThanOrEqual(0.02);
  });

  it("reads lying in 3D: between 60° and 120° from upright in at least 90 frames of 100 (measured: all 321)", () => {
    const lying = trunk.filter((r) => r?.world !== null && r?.world !== undefined && r.world >= 60 && r.world <= 120).length;
    expect(lying / trunk.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe("the engine's three fitted numbers are the ones their rules set from Kd's videos", () => {
  it("the angle limit, the length limit and the size change", () => {
    expect(chooseAngleLimit(VIDEOS)).toBe(MEASURE_LIMITS.angle);
    expect(chooseLengthLimit(VIDEOS)).toBe(MEASURE_LIMITS.length);
    expect(chooseSizeChange(VIDEOS)).toBe(MEASURE_LIMITS.sizeChange);
  });

  it("the angle limit set from three people: on the fourth, at least 85 in 100 of its flat angles given", () => {
    const folds = leaveOneOut(VIDEOS);
    expect(folds.length).toBe(4);
    // Measured: three folds set 30°, without the squat 25°; given 93 to 99 in 100.
    expect(folds.filter((f) => f.angle === MEASURE_LIMITS.angle).length).toBeGreaterThanOrEqual(3);
    for (const f of folds) expect([f.heldOut, f.kept >= 0.85]).toEqual([f.heldOut, true]);
  });

  it("no one-person video changes its size on the picture by the size change while the person stays in place", () => {
    for (const s of sizeSwings(VIDEOS)) expect([s.label, s.swing < MEASURE_LIMITS.sizeChange]).toEqual([s.label, true]);
  });
});

describe("side on, the near side is read on the flat picture, and flat is the steadier", () => {
  const cases: readonly { label: string; near: readonly MeasureName[] }[] = [
    { label: "squat_reference", near: ["left knee", "left hip", "left thigh lean", "left shin lean", "trunk lean", "hips height", "left ankle height"] },
    { label: "chair_squat_reference", near: ["right knee", "right hip", "right thigh lean", "right shin lean", "trunk lean", "hips height", "right ankle height"] },
  ];
  for (const { label, near } of cases) {
    it(`${label}: at least 95 in 100 frames read in 3D are read flat too, and the knee and hip shake less flat`, () => {
      const measured = runOf(video(label)).measured;
      for (const name of near) {
        const s = summaryOf(measured, name, unitOf(name));
        expect(s.world).toBeGreaterThan(200);
        // Two models that disagree by more than the limit decide nothing; side on, that is rare
        // for the near leg and the trunk.
        expect([name, s.flat / s.world >= 0.95]).toEqual([name, true]);
      }
      for (const name of near.slice(0, 2)) expect([name, steadierOf(summaryOf(measured, name, unitOf(name)))]).toEqual([name, "flat"]);
    });
  }
});

describe("what the side view cannot see is not read on the flat picture", () => {
  it("the squat's feet apart, across her body: never given flat", () => {
    const s = summaryOf(runOf(video("squat_reference")).measured, "feet apart", "trunks");
    // Measured (51c): the phone's model marks her far knee hidden in every frame, so her far foot hangs from nothing and
    // the width is read in no frame, not even in 3D. On the six-person heavy file it was read in 3D in 73 frames, and
    // flat in none (the picture showed 0.51 of the line between the feet at the bottom, reading 0.49 of a trunk against
    // 0.76 in 3D). The general guarantee, every flat reading within its limit of its 3D one, is the next test.
    expect(s.world).toBe(0);
    expect(s.flat).toBe(0);
  });


  it("on every video, no flat reading is given further from its 3D one than the limit", () => {
    // The guarantee, on real points. Measured, as an example of a reading at the edge: the chair
    // squat's folded arm, pointing at the camera, reads 24° flat and 49° in 3D in the middle, and is given.
    for (const v of VIDEOS) {
      for (const body of runOf(v).measured) {
        for (const { name, unit } of MEASURE_LIST) {
          const r = body.readings.get(name);
          if (r === undefined || r.flat === null) continue;
          const limit = unit === "degrees" ? MEASURE_LIMITS.angle : MEASURE_LIMITS.length;
          expect([v.label, name, r.off !== null && r.off <= limit]).toEqual([v.label, name, true]);
        }
      }
    }
  });
});

describe("the squat against Kd's own measuring of it", () => {
  // Kd's analyze_squat.py (2026-09-28), its own way on the same video, in his folder's
  // squat/reference_profile.json: each rep's frames, and its bottom and top, flat and 3D.
  const KD = [
    { from: 16, to: 82, knee: 99.2, hip: 89.4, trunk: 33.5, shin: 23.7, knee3d: 105.1, drop: 0.36 },
    { from: 122, to: 193, knee: 98.8, hip: 90.1, trunk: 33.2, shin: 24.5, knee3d: 105.6, drop: 0.35 },
    { from: 255, to: 326, knee: 96.5, hip: 87.1, trunk: 35.4, shin: 26.0, knee3d: 101.9, drop: 0.37 },
  ];
  // His tops are the standing between reps, the first before 0.5 s, where nothing is read yet.
  const TOPS = [
    { from: 82, to: 122, knee: 175.7, hip: 179.5 },
    { from: 193, to: 255, knee: 175.2, hip: 177.6 },
  ];
  // His measuring read the heavy model's points (his profile says so), so the way this engine measures is checked on
  // the heavy model's own file of the same video (test/outside), and the phone's model is told apart below.
  const HEAVY = outsideVideo("squat_reference.heavy.bodypoints");
  const PHONE = video("squat_reference");
  const readingOf = (v: Video, i: number, name: MeasureName) => runOf(v).measured[i]?.readings.get(name) ?? null;
  const alongOf = (v: Video, from: number, to: number, name: MeasureName, which: "flat" | "world"): { i: number; v: number }[] =>
    Array.from({ length: to - from + 1 }, (_, k) => from + k).flatMap((i) => {
      const x = readingOf(v, i, name)?.[which] ?? null;
      return x === null ? [] : [{ i, v: x }];
    });
  const along = (from: number, to: number, name: MeasureName, which: "flat" | "world") => alongOf(HEAVY, from, to, name, which);

  it("each rep's bottom, at its deepest knee: within 3° of his (the 3D knee 3.5°), and the hips' drop within 0.05 of a leg", () => {
    for (const rep of KD) {
      const knee = along(rep.from, rep.to, "left knee", "flat");
      const bottom = knee.reduce((a, b) => (b.v < a.v ? b : a));
      const at = (name: MeasureName, which: "flat" | "world" = "flat"): number => readingOf(HEAVY, bottom.i, name)?.[which] ?? Number.NaN;
      expect(Math.abs(bottom.v - rep.knee)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("left hip") - rep.hip)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("trunk lean") - rep.trunk)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("left shin lean") - rep.shin)).toBeLessThanOrEqual(3);
      // The 3D knee: steadied in 3D more loosely since 51c (+20 Hz a metre a second, set by its rule), it reaches a little
      // deeper at each bottom than his median filter does. Measured: 3.0°, 3.2° and 2.1° below his (2.5°, 2.6°, 1.9° at +10).
      expect(Math.abs(at("left knee", "world") - rep.knee3d)).toBeLessThanOrEqual(3.5);
      const hips = along(rep.from, rep.to, "hips height", "flat").map((x) => x.v);
      expect(Math.abs(Math.max(...hips) - Math.min(...hips) - rep.drop)).toBeLessThanOrEqual(0.05);
    }
  });

  it("standing between reps: the knee and hip within 3° of his", () => {
    for (const top of TOPS) {
      expect(Math.abs(Math.max(...along(top.from, top.to, "left knee", "flat").map((x) => x.v)) - top.knee)).toBeLessThanOrEqual(3);
      expect(Math.abs(Math.max(...along(top.from, top.to, "left hip", "flat").map((x) => x.v)) - top.hip)).toBeLessThanOrEqual(3);
    }
  });

  it("the phone's model on the same video: each rep's deepest knee and hip, and the standing knee and hip, within 5° of his", () => {
    // Not a check of the measuring (that is the heavy file's, above): how far the phone's own model, asked for one
    // person, reads this body from the heavy one. Measured (51c): the deepest knee 2.8°, 0.2° and 0.3° from his, the hip
    // 3.0°, 0.9° and 1.5°; standing, the knee 4.3° and 4.8°, the hip 0.5° and 2.3°.
    const gaps: number[] = [];
    for (const rep of KD) {
      const knee = alongOf(PHONE, rep.from, rep.to, "left knee", "flat");
      const bottom = knee.reduce((a, b) => (b.v < a.v ? b : a));
      gaps.push(Math.abs(bottom.v - rep.knee), Math.abs((readingOf(PHONE, bottom.i, "left hip")?.flat ?? Number.NaN) - rep.hip));
    }
    for (const top of TOPS) {
      gaps.push(Math.abs(Math.max(...alongOf(PHONE, top.from, top.to, "left knee", "flat").map((x) => x.v)) - top.knee));
      gaps.push(Math.abs(Math.max(...alongOf(PHONE, top.from, top.to, "left hip", "flat").map((x) => x.v)) - top.hip));
    }
    for (const g of gaps) expect(g).toBeLessThanOrEqual(5);
  });
});

describe("every video", () => {
  it("never gives a flat reading without its 3D one, nor without saying how much the picture shows", () => {
    for (const v of VIDEOS) {
      for (const body of runOf(v).measured) {
        for (const r of body.readings.values()) {
          if (r.flat === null) continue;
          expect(r.world).not.toBeNull();
          expect(r.shown).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });

  for (const v of VIDEOS) {
    it(`${v.label}: at half the frames a second, nearly every reading is the same`, () => {
      const a = agreementOf(runOf(v).measured, runMeasures(runSteady(runChecks(halfRate(v.frames)))));
      expect(a.compared).toBeGreaterThan(0);
      // Measured (51c): 0 to 1 in 100 read by one run and not the other; 95 in 100 within 0.5° to 2.1°, and within
      // 0.01 to 0.04 of a length, the bench press videos included now that the model follows one body (on the
      // six-person files the stand-in follower picked his reflection or his second finding at the other rate: 4 and 6
      // in 100).
      expect(a.differ / a.compared).toBeLessThanOrEqual(0.015);
      expect(a.apart.angle).toBeLessThan(3.5);
      if (Number.isFinite(a.apart.length)) expect(a.apart.length).toBeLessThan(0.06);
    });
  }
});

describe("what measure-check draws", () => {
  it("at most eight frames, each with its time and the measures read in it", () => {
    const drawn = framesToDraw(runOf(video("squat_reference")));
    expect(drawn.length).toBe(8);
    for (const d of drawn) {
      expect(d.lines[0]).toMatch(/^\d+\.\d\d s {2}frame \d+$/);
      expect(d.lines.some((l) => l.startsWith("left knee: flat "))).toBe(true);
    }
    expect(kindOf("degrees")).toBe("angle");
  });
});
