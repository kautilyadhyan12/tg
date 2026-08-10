// Tests for the person gate (camera-accuracy card, phase 2, card 4).
//
// The gate's job is to stop the app counting reps for a chair. Its FAILURE mode
// is the expensive one — a gate that blocks a real person stops them counting
// reps in their own workout — so these tests are weighted toward the two things
// that would cause that: the default when nothing is known, and the direction of
// the comparison.
//
// No cut-off is asserted here and none is chosen anywhere in this package. The
// numbers come from `scripts/measure-pose.ts` run on real clips, and the ruling
// on them is Kd's (OWED: no threshold picked from judgement).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PoseFrame } from "@app/shared";
import { PersonGate } from "../src/scene/personGate.js";
import { cutoffAtPersonCost, readClip, type SignalName } from "../src/scene/discriminators.js";
import { bodyFrame, FRAME_MS, furnitureClip, personClip } from "./sceneFixtures.js";

const WINDOW = 15; // ~1s at the app's 15fps engine feed

/** Every frame's verdict for a whole clip, the way the app will see them. */
function verdicts(
  frames: readonly PoseFrame[],
  signal: SignalName,
  cutoff: number,
  window = WINDOW,
): boolean[] {
  const gate = new PersonGate({ rules: [{ signal, cutoff }], window });
  return frames.map((f) => gate.push(f).blocked);
}

describe("the live gate and the offline measurement cannot disagree", () => {
  // THE POINT OF THIS TEST. Kd rules a cut-off on a table produced by
  // `measure-pose.ts` (offline, whole-clip). The app then enforces that number
  // frame by frame. If those two read "the last second" differently, the number
  // he approved describes one thing and the shipped behaviour another — and the
  // difference would be invisible, because each side is self-consistent. They
  // share one `RollingWindow`; this proves the sharing on real frame sequences
  // rather than on the shape of the source.
  const signals: SignalName[] = [
    "centre_drift",
    "bone_stretch",
    "limb_asymmetry",
    "motion_incoherence",
  ];

  for (const clipName of ["person", "furniture"] as const) {
    const frames = clipName === "person" ? personClip(120) : furnitureClip(120);
    const offline = readClip(frames, WINDOW);
    for (const signal of signals) {
      it(`reads the same series as readClip: ${clipName} / ${signal}`, () => {
        const gate = new PersonGate({ rules: [{ signal, cutoff: 0 }], window: WINDOW });
        const live = frames.map((f) => gate.push(f).values[0] ?? null);
        expect(live).toEqual(offline.windows[signal]);
      });
    }
  }
});

describe("the promised cost is the cost that is actually paid", () => {
  // A PERMANENT GUARD (:5348 rule 5), and it exists because the divergence it
  // catches was real: `shareAbove` was left comparing `>=` while the gate blocks
  // on `>`, so the operating-point table over-reported the person cost and
  // over-promised the furniture catch — by exactly the frames sitting ON the
  // number. The block above proves the two sides read the same VALUES; this
  // proves they turn those values into the same VERDICTS.
  //
  // The boundary is not a corner case being hunted for sport: `cutoffAtPersonCost`
  // returns a quantile of the person's own readings, so the cut-off IS one of
  // them every single time. Flip either comparison and this goes red.
  for (const signal of ["bone_stretch", "motion_incoherence"] as const) {
    it(`blocks exactly the share the table promised: ${signal}`, () => {
      const person = personClip(200);
      const furniture = furnitureClip(200);
      const point = cutoffAtPersonCost(
        readClip(person, WINDOW).windows[signal],
        readClip(furniture, WINDOW).windows[signal],
        0.05,
      );
      expect(point).not.toBeNull();
      if (point === null) return;

      for (const [clip, promised] of [
        [person, point.personRejected],
        [furniture, point.nobodyCaught],
      ] as const) {
        const gate = new PersonGate({ rules: [{ signal, cutoff: point.cutoff }], window: WINDOW });
        let measured = 0;
        let blocked = 0;
        for (const frame of clip) {
          const verdict = gate.push(frame);
          if (verdict.values[0] === null) continue; // no reading is not a verdict
          measured++;
          if (verdict.blocked) blocked++;
        }
        expect(measured).toBeGreaterThan(0);
        expect(blocked / measured).toBe(promised);
      }
    });
  }
});

describe("what it does when it knows nothing", () => {
  it("counts — a gate with no reading yet never blocks", () => {
    // The first second of every set, and any stretch where the model reported
    // nothing usable. Blocking here would take counting away on no evidence.
    const gate = new PersonGate({
      rules: [{ signal: "motion_incoherence", cutoff: -1 }], // a cut-off nothing can pass
      window: WINDOW,
    });
    const first = gate.push(bodyFrame(0, 0.5, 0.5, 0));
    expect(first.values[0]).toBeNull();
    expect(first.blocked).toBe(false);
  });

  it("keeps counting through frames it cannot measure at all", () => {
    // A frame with no landmarks yields no reading. The engine already handles
    // that case (hold, count nothing); the gate must not ALSO fire, or a brief
    // dropout would be reported to the user as "that isn't a person".
    const gate = new PersonGate({
      rules: [{ signal: "bone_stretch", cutoff: -1 }],
      window: WINDOW,
    });
    const empty: PoseFrame = { t: 0, kp: [] };
    for (let i = 0; i < 30; i++) {
      expect(gate.push({ ...empty, t: i * FRAME_MS }).blocked).toBe(false);
    }
  });

  it("does not block a clip of a real person on any signal, at a cut-off measured from that person", () => {
    // The gate's harmful direction, pinned end to end: a cut-off set above the
    // person's own readings must leave every frame of them counting.
    const frames = personClip(120);
    const offline = readClip(frames, WINDOW);
    for (const signal of ["centre_drift", "bone_stretch", "motion_incoherence"] as const) {
      const values = offline.windows[signal].filter((v): v is number => v !== null);
      const highest = Math.max(...values);
      expect(verdicts(frames, signal, highest).some(Boolean)).toBe(false);
    }
  });
});

describe("the direction of the comparison", () => {
  it("blocks the fake skeleton and passes the real body at one shared cut-off", () => {
    // If the comparison ever ran backwards, this is the test that goes red —
    // and running backwards is the failure that rejects every real user.
    const person = personClip(120);
    const furniture = furnitureClip(120);
    const offline = readClip(person, WINDOW);
    const values = offline.windows.motion_incoherence.filter((v): v is number => v !== null);
    const cutoff = Math.max(...values) * 1.5;

    expect(verdicts(person, "motion_incoherence", cutoff).filter(Boolean).length).toBe(0);
    const blockedFurniture = verdicts(furniture, "motion_incoherence", cutoff).filter(Boolean);
    expect(blockedFurniture.length).toBeGreaterThan(60);
  });
});

describe("coming back", () => {
  it("stops blocking once the body is back, rather than latching for the set", () => {
    // The window must FORGET. A gate that kept every reading it had ever seen
    // would stay blocked for the rest of a set after one bad stretch — the user
    // steps back into frame and the app never starts counting again, which is
    // the failure :6008 exists to prevent arriving by another route.
    const furniture = furnitureClip(60);
    const after = furniture.length * FRAME_MS;
    const person = personClip(60).map((f) => ({ ...f, t: f.t + after }));
    const gate = new PersonGate({
      rules: [{ signal: "bone_stretch", cutoff: 0.78 }],
      window: WINDOW,
    });

    let lastFurniture = false;
    for (const f of furniture) lastFurniture = gate.push(f).blocked;
    expect(lastFurniture).toBe(true);

    const verdictsAfter = person.map((f) => gate.push(f).blocked);
    expect(verdictsAfter.at(-1)).toBe(false);
    // ...and it lets go within about a window, not eventually.
    expect(verdictsAfter.slice(0, WINDOW * 2).filter((b) => !b).length).toBeGreaterThan(0);
  });
});

describe("combining rules", () => {
  const frames = furnitureClip(120);
  // One rule that fires on this clip, one that cannot fire at all.
  const firing = { signal: "motion_incoherence" as const, cutoff: 0 };
  const silent = { signal: "bone_stretch" as const, cutoff: 1e9 };

  it("'any' blocks when one rule fires", () => {
    const gate = new PersonGate({ rules: [firing, silent], mode: "any", window: WINDOW });
    expect(frames.map((f) => gate.push(f).blocked).some(Boolean)).toBe(true);
  });

  it("'all' does not block unless every rule fires", () => {
    const gate = new PersonGate({ rules: [firing, silent], mode: "all", window: WINDOW });
    expect(frames.map((f) => gate.push(f).blocked).some(Boolean)).toBe(false);
  });

  it("reports one value per rule, in the order the rules were given", () => {
    const gate = new PersonGate({ rules: [firing, silent], window: WINDOW });
    let last = gate.push(frames[0] ?? bodyFrame(0, 0.5, 0.5, 0));
    for (const f of frames) last = gate.push(f);
    expect(last.values).toHaveLength(2);
  });
});

describe("starting again", () => {
  it("reset() forgets the previous frame, so a new set is not measured against the old one", () => {
    // THE FIRST VERSION OF THIS TEST COULD NOT FAIL, and the mutation sweep is
    // what said so (P4 came back ALIVE). It reset the gate and pushed one frame
    // with a far-future timestamp, expecting "no reading" — but a stale previous
    // frame is MORE than the 500ms gap allowance away, so the gap rule returned
    // "no reading" too. Both the fixed and the broken code passed. The shape is
    // :5104's F5: a fix whose protection cannot fail is the same defect with a
    // comment on it.
    //
    // The honest question is "does a reset gate behave EXACTLY like a new one",
    // so it is asked directly: same second clip, one fresh gate, one reset gate,
    // series compared. A stale previous frame changes the first reading from
    // "nothing yet" to a real measurement, and the two series diverge.
    const first = personClip(30);
    const second = personClip(30, 9).map((f) => ({ ...f, t: f.t + first.length * FRAME_MS }));
    const rules = [{ signal: "centre_drift" as const, cutoff: 0.05 }];

    const fresh = new PersonGate({ rules, window: 5 });
    const reused = new PersonGate({ rules, window: 5 });
    for (const f of first) reused.push(f);
    reused.reset();

    const fromFresh = second.map((f) => fresh.push(f).values[0] ?? null);
    const fromReused = second.map((f) => reused.push(f).values[0] ?? null);
    expect(fromReused).toEqual(fromFresh);
    expect(fromFresh[0]).toBeNull(); // the control: a new gate knows nothing yet
  });
});

describe("configuration that would be a lie", () => {
  it("refuses to be built with no rules rather than answering 'never block'", () => {
    expect(() => new PersonGate({ rules: [], window: WINDOW })).toThrow(/at least one rule/);
  });
});

describe("the scene module stays out of the engine pipeline", () => {
  // A PERMANENT GUARD (:5348 rule 5), not a style rule. The 2026-08-07 ruling
  // puts this check in the web bridge: the engine is handed 33 numbers and
  // cannot know they came from a chair, and R5.6 forbids scene special-cases in
  // engine code. The scene module is deliberately absent from the package index
  // and reachable only through the `@app/engine/scene` entry point — this fails
  // the day someone wires it into the pipeline anyway.
  const SRC = join(import.meta.dirname, "../src");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        out.push(...sourceFiles(path));
      } else if (name.endsWith(".ts")) {
        out.push(path);
      }
    }
    return out;
  }

  it("is imported by nothing under src/, outside src/scene itself", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.includes(join("src", "scene"))) continue;
      if (/from\s+"[^"]*scene\//.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("is not re-exported from the package index", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(index).not.toMatch(/scene/);
  });
});
