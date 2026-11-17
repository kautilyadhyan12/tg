// The body measures on Kd's six kept videos (ROADMAP 50c-iii): a part pointing at the camera is
// never read on the flat picture; side on, the near side is read flat in every frame and the flat
// reading is the steadier; the squat agrees with Kd's own measuring of it; the same video at half
// the frames a second gets the same answers.
import { describe, expect, it } from "vitest";
import { MEASURE_LIST, type MeasureName } from "../src/index.js";
import { halfRate, runChecks, runSteady, type Video } from "../scripts/bodyCheck.js";
import { agreementOf, framesToDraw, kindOf, runMeasures, runOf, steadierOf, summaryOf } from "../scripts/measureCheck.js";
import { VIDEOS } from "./helpers/body.js";

function video(label: string): Video {
  const v = VIDEOS.find((x) => x.label === label);
  if (v === undefined) throw new Error(`no kept video ${label}`);
  return v;
}
const unitOf = (name: MeasureName) => MEASURE_LIST.find((m) => m.name === name)?.unit ?? "degrees";
const reading = (label: string, i: number, name: MeasureName) => runOf(video(label)).measured[i]?.readings.get(name) ?? null;

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

describe("side on, the near side is read on the flat picture, and flat is the steadier", () => {
  const cases: readonly { label: string; near: readonly MeasureName[] }[] = [
    { label: "squat_reference", near: ["left knee", "left hip", "left thigh lean", "left shin lean", "trunk lean", "hips height", "left ankle height"] },
    { label: "chair_squat_reference", near: ["right knee", "right hip", "right thigh lean", "right shin lean", "trunk lean", "hips height", "right ankle height"] },
  ];
  for (const { label, near } of cases) {
    it(`${label}: every frame read in 3D is read flat too, and the knee and hip shake less flat`, () => {
      const measured = runOf(video(label)).measured;
      for (const name of near) {
        const s = summaryOf(measured, name, unitOf(name));
        expect([name, s.world]).toEqual([name, expect.any(Number)]);
        expect(s.world).toBeGreaterThan(200);
        expect([name, s.flat]).toEqual([name, s.world]);
      }
      for (const name of near.slice(0, 2)) expect([name, steadierOf(summaryOf(measured, name, unitOf(name)))]).toEqual([name, "flat"]);
    });
  }
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
  const label = "squat_reference";
  const along = (from: number, to: number, name: MeasureName, which: "flat" | "world"): { i: number; v: number }[] =>
    Array.from({ length: to - from + 1 }, (_, k) => from + k).flatMap((i) => {
      const v = reading(label, i, name)?.[which] ?? null;
      return v === null ? [] : [{ i, v }];
    });

  it("each rep's bottom, at its deepest knee: within 3° of his, and the hips' drop within 0.05 of a leg", () => {
    for (const rep of KD) {
      const knee = along(rep.from, rep.to, "left knee", "flat");
      const bottom = knee.reduce((a, b) => (b.v < a.v ? b : a));
      const at = (name: MeasureName, which: "flat" | "world" = "flat"): number => reading(label, bottom.i, name)?.[which] ?? Number.NaN;
      expect(Math.abs(bottom.v - rep.knee)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("left hip") - rep.hip)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("trunk lean") - rep.trunk)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("left shin lean") - rep.shin)).toBeLessThanOrEqual(3);
      expect(Math.abs(at("left knee", "world") - rep.knee3d)).toBeLessThanOrEqual(3);
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
      if (v.onePerson) {
        // Measured: 0 to 1 in 100 read by one run and not the other; 95 in 100 within 0.9° to
        // 2.8°, and within 0.02 to 0.05 of a length.
        expect(a.differ / a.compared).toBeLessThanOrEqual(0.015);
        expect(a.apart.angle).toBeLessThan(3.5);
        if (Number.isFinite(a.apart.length)) expect(a.apart.length).toBeLessThan(0.06);
      } else {
        // The bench press videos: the stand-in follower can pick the man's reflection or his
        // second finding at the other rate (job 52d). Measured: 4 and 6 in 100.
        expect(a.differ / a.compared).toBeLessThanOrEqual(0.08);
      }
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
