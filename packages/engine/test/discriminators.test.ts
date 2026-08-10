// Tests for the landmark-only "is a body actually there?" discriminators
// (camera-accuracy card, phase 2). The synthetic clips these run on, and why
// they are the right oracle, are documented in `sceneFixtures.ts` — shared with
// the gate's own suite rather than copied into it.
import { describe, expect, it } from "vitest";
import type { PoseFrame } from "@app/shared";
import { KP } from "@app/shared";
import {
  bodyCentre,
  cutoffAtCatchRate,
  cutoffAtPersonCost,
  distribution,
  readClip,
  readFrame,
  separation,
  SIGNAL_NAMES,
  torsoLength,
  windowed,
} from "../src/scene/discriminators.js";
import { bodyFrame, FRAME_MS, furnitureClip, personClip } from "./sceneFixtures.js";

describe("torsoLength / bodyCentre", () => {
  it("measures the shoulder-to-hip span and the centre of the four torso points", () => {
    const f = bodyFrame(0, 0.5, 0.5, 0);
    // shoulders at y=0.38, hips at y=0.62 → span 0.24, centre y = 0.5.
    expect(torsoLength(f)).toBeCloseTo(0.24, 6);
    const centre = bodyCentre(f);
    expect(centre?.[0]).toBeCloseTo(0.5, 6);
    expect(centre?.[1]).toBeCloseTo(0.5, 6);
  });

  it("returns null rather than a number when a torso landmark is missing", () => {
    const f = bodyFrame(0, 0.5, 0.5, 0);
    const broken: PoseFrame = {
      t: f.t,
      kp: f.kp.map((row, i) =>
        i === KP.left_hip ? [Number.NaN, Number.NaN, 0, 0.99] : row,
      ),
    };
    // A substituted zero here would read downstream as "perfectly still" —
    // the exact shape of lie this card exists to remove.
    expect(torsoLength(broken)).toBeNull();
    expect(bodyCentre(broken)).toBeNull();
  });

  it("returns null when every landmark has collapsed to one point", () => {
    const collapsed: PoseFrame = {
      t: 0,
      kp: Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.99] as [number, number, number, number]),
    };
    expect(torsoLength(collapsed)).toBeNull();
  });
});

describe("readFrame", () => {
  it("reports nothing measurable on the first frame of a clip", () => {
    const r = readFrame(bodyFrame(0, 0.5, 0.5, 0), null);
    expect(r.centre_drift).toBeNull();
    expect(r.bone_stretch).toBeNull();
    expect(r.motion_incoherence).toBeNull();
    // ...except asymmetry, which needs no history.
    expect(r.limb_asymmetry).not.toBeNull();
  });

  it("skips a pair whose frames are further apart than the gap allowance", () => {
    const a = bodyFrame(0, 0.5, 0.5, 0);
    const far = bodyFrame(2000, 0.6, 0.5, 0);
    expect(readFrame(far, a, 500).centre_drift).toBeNull();
    // The identical pair inside the allowance IS measured — proving the null
    // above comes from the gap rule and not from the frames being unreadable.
    const near = bodyFrame(400, 0.6, 0.5, 0);
    expect(readFrame(near, a, 500).centre_drift).not.toBeNull();
  });

  it("expresses drift as a RATE: half the time step, double the reading", () => {
    const a = bodyFrame(0, 0.5, 0.5, 0);
    const slow = readFrame(bodyFrame(100, 0.51, 0.5, 0), a).centre_drift;
    const fast = readFrame(bodyFrame(50, 0.51, 0.5, 0), a).centre_drift;
    expect(slow).not.toBeNull();
    expect(fast).toBeCloseTo((slow ?? 0) * 2, 6);
  });

  it("is scale-invariant: the same motion twice as far from the camera reads the same", () => {
    // Everything (including the step) halved — a smaller person moving
    // proportionally must not score as jitterier than a nearer one.
    const near = readFrame(bodyFrame(FRAME_MS, 0.52, 0.5, 0), bodyFrame(0, 0.5, 0.5, 0));
    const shrink = (f: PoseFrame): PoseFrame => ({
      t: f.t,
      kp: f.kp.map((row) => [
        0.5 + (row[0] - 0.5) / 2,
        0.5 + (row[1] - 0.5) / 2,
        row[2],
        row[3],
      ]),
    });
    const far = readFrame(
      shrink(bodyFrame(FRAME_MS, 0.52, 0.5, 0)),
      shrink(bodyFrame(0, 0.5, 0.5, 0)),
    );
    expect(far.centre_drift).toBeCloseTo(near.centre_drift ?? 0, 6);
  });

  it("reads zero stretch on a rigid body that is moving", () => {
    // A body translating bodily across the frame changes no bone length.
    const r = readFrame(bodyFrame(FRAME_MS, 0.6, 0.5, 0), bodyFrame(0, 0.5, 0.5, 0));
    expect(r.bone_stretch).toBeCloseTo(0, 9);
    expect(r.centre_drift).toBeGreaterThan(0);
  });
});

describe("windowed", () => {
  it("takes the median, so one spiking frame cannot trip a gate", () => {
    const flat = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const spiked = [...flat];
    spiked[5] = 1000;
    const out = windowed(spiked, 5);
    expect(out[9]).toBe(1);
    expect(Math.max(...out.filter((v): v is number => v !== null))).toBe(1);
  });

  it("stays null until the window holds enough real readings", () => {
    const out = windowed([null, null, 1, 1, 1, 1], 6);
    expect(out[0]).toBeNull();
    expect(out[2]).toBeNull(); // 1 reading, needs 3
    expect(out[5]).toBe(1); // 4 readings
  });
});

describe("separation (AUC)", () => {
  it("is 1 when the piles never overlap and 0.5 when they are identical", () => {
    expect(separation([1, 2, 3], [4, 5, 6])).toBe(1);
    expect(separation([4, 5, 6], [1, 2, 3])).toBe(0);
    expect(separation([1, 2, 3], [1, 2, 3])).toBe(0.5);
  });

  it("counts ties as half, so a constant signal scores 0.5 and not 1", () => {
    expect(separation([1, 1], [1, 1])).toBe(0.5);
  });

  it("ignores nulls rather than treating them as zero", () => {
    expect(separation([1, null, 2, 3], [4, null, 5, 6])).toBe(1);
  });
});

describe("operating points", () => {
  const person = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const nobody = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  it("pins the cut-off by the PERSON cost and reports the furniture caught", () => {
    const p = cutoffAtPersonCost(person, nobody, 0.1);
    expect(p?.cutoff).toBe(10);
    expect(p?.personRejected).toBe(0);
    expect(p?.nobodyCaught).toBe(1);
  });

  it("reports a real cost when the piles overlap — it never hides one", () => {
    const overlapping = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const p = cutoffAtPersonCost(overlapping, nobody, 0.5);
    // Half the person readings sit above the cut-off, and the table says so.
    expect(p?.personRejected).toBeGreaterThan(0.3);
  });

  it("gives the mirror view: catch 95% of furniture, and what it costs", () => {
    const p = cutoffAtCatchRate(person, nobody, 0.95);
    expect(p?.nobodyCaught).toBeGreaterThanOrEqual(0.9);
    expect(p?.personRejected).toBe(0);
  });

  it("returns null instead of a fabricated cut-off when a pile is empty", () => {
    expect(cutoffAtPersonCost([], nobody, 0.01)).toBeNull();
    expect(cutoffAtCatchRate(person, [], 0.95)).toBeNull();
  });
});

describe("the whole pipeline on synthetic clips", () => {
  const window = 15;
  const person = readClip(personClip(180), window);
  const furniture = readClip(furnitureClip(180), window);

  it("separates a rigid moving body from a re-guessed skeleton, on every signal", () => {
    for (const name of SIGNAL_NAMES) {
      const auc = separation(person.windows[name], furniture.windows[name]);
      // 0.5 is a worthless signal. Anything that cannot clear this on fixtures
      // this extreme has no chance on a real chair, and should be deleted
      // rather than carried into the threshold conversation.
      expect(auc, `${name} separation`).toBeGreaterThan(0.9);
    }
  });

  it("reads the person clip as the QUIETER one — the direction the gate depends on", () => {
    // Every signal runs one way (higher = more like furniture). A signal that
    // silently ran backwards would invert the gate and reject real users.
    for (const name of SIGNAL_NAMES) {
      const p = distribution(person.windows[name]);
      const f = distribution(furniture.windows[name]);
      expect(f.median, `${name} median`).toBeGreaterThan(p.median);
    }
  });

  it("produces readings for most frames rather than a mostly-null series", () => {
    for (const name of SIGNAL_NAMES) {
      const d = distribution(person.windows[name]);
      expect(d.count, `${name} count`).toBeGreaterThan(150);
    }
  });

  it("counts the skipped gaps instead of quietly measuring across them", () => {
    const frames = personClip(20);
    const gapped = frames.map((f, i) => (i >= 10 ? { ...f, t: f.t + 5000 } : f));
    expect(readClip(gapped, window).gapsSkipped).toBe(1);
    expect(readClip(frames, window).gapsSkipped).toBe(0);
  });
});
