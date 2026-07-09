// Part 2 §7.6 — the fuzz pass (I6 made mechanical). Take a CLEAN golden trace,
// then inject the three degradations the spec names — random NaN, landmark
// dropout bursts, fps jitter (8–40) — and assert the three invariants:
//   · no throw (any escaping throw is a P0, R5.3)
//   · rep count never INCREASES vs the clean baseline (garbage can't manufacture
//     reps; §7.6 wording is "no count increase")
//   · recovery — after the signal returns, counting resumes (not wedged)
// Determinism: the corruptions are driven by a SEEDED PRNG (in test code, not
// engine src — purity holds), so any failure reproduces from its seed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema, type ExerciseDefinition, type PoseFrame } from "@app/shared";
import { compileDefinition, createSession, parseTrace } from "../src/index.js";
import { must } from "./fixtures.js";

const PARITY = join(import.meta.dirname, "traces", "parity");
const DEFS = join(import.meta.dirname, "../src/definitions");
const FPS_MS = 1000 / 15;

type KP = [number, number, number, number];

function loadDef(ex: string): ExerciseDefinition {
  return exerciseDefinitionSchema.parse(JSON.parse(readFileSync(join(DEFS, `${ex}.json`), "utf8")));
}
function loadFrames(name: string): PoseFrame[] {
  return clone(parseTrace(readFileSync(join(PARITY, `${name}.jsonl`), "utf8")).frames);
}
function clone(frames: readonly PoseFrame[]): PoseFrame[] {
  return frames.map((f) => ({ t: f.t, kp: f.kp.map((k) => [...k] as KP) }));
}
/** Feed frames straight through a fresh session; returns the final rep count.
 *  Throwing here IS the failure (I6). */
function runReps(def: ExerciseDefinition, frames: readonly PoseFrame[]): number {
  const s = createSession(compileDefinition(def, 1));
  for (const f of frames) s.processFrame(f);
  return s.end().reps;
}

/** Small seeded PRNG (mulberry32) — deterministic corruption. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function injectNaN(frames: PoseFrame[], rnd: () => number, p: number): PoseFrame[] {
  return frames.map((f) => {
    if (rnd() >= p) return f;
    const j = Math.floor(rnd() * f.kp.length);
    return { t: f.t, kp: f.kp.map((k, idx) => (idx === j ? ([NaN, NaN, k[2], k[3]] as KP) : ([...k] as KP))) };
  });
}
function dropoutBurst(frames: PoseFrame[], rnd: () => number): PoseFrame[] {
  const out = clone(frames);
  const bursts = 1 + Math.floor(rnd() * 3);
  for (let b = 0; b < bursts; b++) {
    const start = Math.floor(rnd() * out.length);
    const len = 5 + Math.floor(rnd() * 16);
    for (let i = start; i < Math.min(start + len, out.length); i++) {
      const fr = must(out[i]);
      fr.kp = fr.kp.map((k) => [k[0], k[1], k[2], 0] as KP); // visibility 0 = occluded
    }
  }
  return out;
}
function fpsJitter(frames: PoseFrame[], rnd: () => number): PoseFrame[] {
  let t = 0;
  return frames.map((f) => {
    t += 25 + rnd() * 100; // per-frame gap 25–125 ms ⇒ 8–40 fps, monotonic
    return { t, kp: f.kp.map((k) => [...k] as KP) };
  });
}

const CLIPS = [
  { def: "squat", trace: "sqauta_sideview1goodform" },
  { def: "chair_squat", trace: "Chair_Squat_goodform_sideview1" },
  { def: "jump_squat", trace: "jump_squat_goodform_sideview2" },
] as const;
const SEEDS = 40;

describe("fuzz pass (§7.6 / I6)", () => {
  for (const { def: defKey, trace: traceName } of CLIPS) {
    const def = loadDef(defKey);
    const clean = loadFrames(traceName);
    const baseline = runReps(def, clean);

    it(`${defKey}: NaN/dropout/jitter never throw and never INCREASE reps (clean baseline=${String(baseline)})`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rnd = mulberry32(seed);
        const variants: PoseFrame[][] = [
          injectNaN(clone(clean), rnd, 0.15),
          dropoutBurst(clone(clean), rnd),
          fpsJitter(clone(clean), rnd),
          fpsJitter(dropoutBurst(injectNaN(clone(clean), rnd, 0.1), rnd), rnd),
        ];
        for (const [k, v] of variants.entries()) {
          let reps = -1;
          expect(() => {
            reps = runReps(def, v);
          }, `${defKey} seed ${String(seed)} variant ${String(k)} threw`).not.toThrow();
          expect(
            reps,
            `${defKey} seed ${String(seed)} variant ${String(k)}: reps ${String(reps)} exceeded clean baseline ${String(baseline)}`,
          ).toBeLessThanOrEqual(baseline);
        }
      }
    });
  }

  it("recovers after a full dropout burst (resumes counting on the clean tail)", () => {
    const def = loadDef("squat");
    const clean = loadFrames("sqauta_sideview1goodform");
    // A fully-occluded copy (contributes 0 reps) followed by the clean clip;
    // re-timestamped monotonic. Recovery = the clean tail still counts.
    const blanked = clean.map((f) => ({ t: f.t, kp: f.kp.map((k) => [k[0], k[1], k[2], 0] as KP) }));
    const seq = [...blanked, ...clean].map((f, i) => ({ t: i * FPS_MS, kp: f.kp }));
    expect(
      runReps(def, seq),
      "engine did not recover — no reps counted in the clean tail after a full dropout",
    ).toBeGreaterThan(0);
  });
});
