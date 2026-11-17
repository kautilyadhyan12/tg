// Steady points (ROADMAP 50c-ii; spec Part 2 §12.2, stage 3): the shake taken out of a used
// point, without trailing a real movement, by the frames' times and never by their count; and
// only a used point ever gets a steady value.
import { describe, expect, it } from "vitest";
import { KP } from "@app/shared";
import { MAIN_JOINTS, PossibleBody, SteadyPoints, type SteadyBody } from "../src/index.js";
import { runChecks, runSteady } from "../scripts/bodyCheck.js";
import { ASPECT, SIZE, VIDEOS, feed, type Feed } from "./helpers/body.js";

function steady(frames: readonly Feed[]): SteadyBody[] {
  const check = new PossibleBody();
  const smooth = new SteadyPoints();
  return frames.map((f) => smooth.next(check.check(f.t, ASPECT, [0, 1, 0], f.person)));
}

/** Metres between two places on the picture, for a body of SIZE. */
const metres = (dx: number, dy: number): number => Math.hypot(dx * ASPECT, dy) / SIZE;

function spread(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

describe("steady points", () => {
  it("take most of the shake out of a body standing still", () => {
    const frames = feed(4, 30);
    const out = steady(frames).filter((s) => s.t >= 1500);
    const raw = frames.filter((f) => f.t >= 1500);
    const joints: number[] = [KP.left_knee, KP.right_wrist, KP.nose];
    for (const j of joints) {
      const rawX = raw.map((f) => (f.person?.points[j]?.[0] ?? 0) * ASPECT);
      const steadyX = out.map((s) => (s.points[j]?.x ?? 0) * ASPECT);
      expect(spread(steadyX)).toBeLessThan(spread(rawX) / 3);
    }
  });

  it("follow a hand moving at up to a metre a second to within 2.5 cm, and catch up when it stops", () => {
    // From 2 s the hand slides 19 cm across the picture in 0.3 s, speeding up and slowing down
    // as a hand does, at most 1 m/s on the way; then it stays.
    const frames = feed(3, 30, (t, world, lay) => {
      const p = lay(world);
      const along = Math.min(Math.max(t - 2000, 0), 300) / 300;
      const shift = ((0.6 / Math.PI) * (1 - Math.cos(Math.PI * along)) * SIZE) / 2;
      for (const i of [KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb]) {
        const q = p.points[i];
        if (q !== undefined) p.points[i] = [q[0] + shift / ASPECT, q[1], q[2], q[3], q[4]];
      }
      return p;
    });
    const out = steady(frames);
    out.forEach((s, n) => {
      const r = frames[n]?.person?.points[KP.left_wrist];
      const k = s.points[KP.left_wrist];
      if (s.t < 1200 || r === undefined || k === null || k === undefined) return;
      // Measured: 2.3 cm behind at its fastest, about 25 ms; 0.2 cm a fifteenth of a second after it stops.
      expect([s.t, metres(k.x - r[0], k.y - r[1]) < 0.025]).toEqual([s.t, true]);
    });
    const last = out.at(-1)?.points[KP.left_wrist];
    const raw = frames.at(-1)?.person?.points[KP.left_wrist];
    expect(metres((last?.x ?? 0) - (raw?.[0] ?? 1), (last?.y ?? 0) - (raw?.[1] ?? 1))).toBeLessThan(0.005);
  });

  it("give a refused point no steady value, and start afresh from where it is when it is used again", () => {
    const frames = feed(3, 30, (t, world, lay) => {
      const p = lay(world);
      const w = p.points[KP.left_wrist];
      if (t >= 1500 && t < 1700 && w !== undefined) p.points[KP.left_wrist] = [w[0], w[1], w[2], 0.2, w[4]];
      return p;
    });
    const out = steady(frames);
    const hidden = out.filter((s) => s.t >= 1500 && s.t < 1700);
    expect(hidden.every((s) => s.points[KP.left_wrist] === null && s.refused[KP.left_wrist] === "hidden")).toBe(true);
    const n = out.findIndex((s) => s.t >= 1700);
    expect(out[n]?.points[KP.left_wrist]?.x).toBe(frames[n]?.person?.points[KP.left_wrist]?.[0]);
    expect(out[n]?.points[KP.left_wrist]?.y).toBe(frames[n]?.person?.points[KP.left_wrist]?.[1]);
  });

  it("are the same at half the frames a second, to within a millimetre on a still body", () => {
    const frames = feed(4, 30);
    const full = steady(frames);
    const half = steady(frames.filter((_, n) => n % 2 === 0));
    for (const h of half.filter((s) => s.t >= 1500)) {
      const f = full.find((s) => Math.abs(s.t - h.t) < 1);
      for (const j of MAIN_JOINTS) {
        const a = f?.points[j];
        const b = h.points[j];
        if (a === null || a === undefined || b === null || b === undefined) continue;
        expect(metres(a.x - b.x, a.y - b.y)).toBeLessThan(0.001);
      }
    }
  });

  for (const video of VIDEOS) {
    it(`${video.label}: a point has a steady value exactly when it is used`, () => {
      for (const s of runSteady(runChecks(video.frames))) {
        s.points.forEach((p, i) => {
          expect([s.t, i, p === null]).toEqual([s.t, i, s.refused[i] !== null]);
        });
      }
    });
  }
});
