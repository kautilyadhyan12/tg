// §7.5 parity for the signal library: the P1.3 sidecars carry the Python
// analyzer's per-frame joint angles. The TS port implements the identical
// formula (arccos of normalized dot), so agreement must be within 1e-6° —
// IEEE-754 arithmetic is platform-identical; only acos may differ by ULPs
// (Part IV #7). Any larger drift is a port bug, not float noise.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SignalEngine,
  VisibilityGate,
  parseTrace,
  type SignalName,
} from "../../src/index.js";

// Python rounds angles to 0.1° (angles.py:62) — the TS port applies the SAME
// rounding, so agreement should be exact; 1e-9 absorbs only representation noise.
const ANGLE_TOLERANCE_DEG = 1e-9;
const PAIRS: [pythonKey: string, signal: SignalName][] = [
  ["left_knee", "knee_L"],
  ["right_knee", "knee_R"],
  ["left_hip", "hip_L"],
  ["right_hip", "hip_R"],
  ["left_elbow", "elbow_L"],
  ["right_elbow", "elbow_R"],
  ["left_shoulder", "shoulder_L"],
  ["right_shoulder", "shoulder_R"],
];

const dir = join(import.meta.dirname, "../traces/parity");
const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.includes("responses"));

describe("signal parity vs Python (§7.5, sidecar angles)", () => {
  for (const f of files) {
    it(`joint angles match within 1e-6° on ${f}`, () => {
      const trace = parseTrace(readFileSync(join(dir, f), "utf8"));
      const rawLines = readFileSync(join(dir, f.replace(".jsonl", ".responses.jsonl")), "utf8")
        .trim()
        .split("\n");
      const responses = rawLines.map(
        (l) => JSON.parse(l) as { angles?: Record<string, number | null>; keypoints?: number[][] },
      );
      // Legacy flood guard: frames arriving <33ms apart (wall-clock jitter at
      // record time) get the PREVIOUS response echoed back byte-identically —
      // that response is not an analysis of this frame. Skip exact repeats.
      const isFloodEcho = (idx: number): boolean => idx > 0 && rawLines[idx] === rawLines[idx - 1];
      const offset = responses.length - trace.frames.length;
      const engine = new SignalEngine(PAIRS.map(([, s]) => s));
      const gate = new VisibilityGate(33);

      let compared = 0;
      trace.frames.forEach((frame, i) => {
        if (isFloodEcho(i + offset)) return;
        const resp = responses[i + offset];
        // Alignment guard: only SOME responses echo keypoints — when present
        // and mismatched, positional pairing sheared: hard-fail, don't skip.
        const echo = resp?.keypoints;
        if (echo?.[0] !== undefined && echo[0][0] !== frame.kp[0]?.[0]) {
          throw new Error(`sidecar alignment shear at frame ${String(i + 1)} in ${f}`);
        }
        frame.kp.forEach((k, j) => gate.update(j, k[3]));
        const mine = engine.compute(frame, gate, null);
        const py = resp?.angles;
        if (!py) return;
        for (const [pyKey, signal] of PAIRS) {
          const pyVal = py[pyKey];
          const tsVal = mine[signal];
          if (typeof pyVal !== "number" || tsVal === null || tsVal === undefined) continue;
          compared++;
          expect(
            Math.abs(tsVal - pyVal),
            `${signal} vs ${pyKey} at frame ${String(i + 1)} in ${f}: ts=${String(tsVal)} py=${String(pyVal)}`,
          ).toBeLessThanOrEqual(ANGLE_TOLERANCE_DEG);
        }
      });
      expect(compared, `no angle comparisons happened in ${f}`).toBeGreaterThan(0);
    });
  }
});
