// Part 2 §7.6 / I5 — the performance gate. Replays a 10-minute trace (real
// golden looped to 9000 frames @15fps) through the REAL engine and asserts:
//   · p95 per-frame cost ≤ the CI tripwire (§7.6 "scaled to the CI baseline
//     machine"). NOTE: the true ≤3 ms mid-Android (₹12k) budget from I5 is a
//     DEVICE number verified at the P5 §3.2 mobile spike — this CI assertion is
//     a REGRESSION TRIPWIRE (a gross slowdown here fails the build), recorded
//     in DECISIONS. A dev/CI box is faster than mid-Android, so passing here is
//     necessary, not sufficient, for the device budget.
//   · heap stays flat across the run (no growing per-frame allocation, I5).
//     Strict bound when run with --expose-gc; a looser leak-tripwire otherwise.
// Node-side timers/process are fine here — test/ is outside the purity boundary.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema, type ExerciseDefinition, type PoseFrame } from "@app/shared";
import { compileDefinition, createSession, parseTrace } from "../src/index.js";
import { must } from "./fixtures.js";

const DEFS = join(import.meta.dirname, "definitions");
const PARITY = join(import.meta.dirname, "traces", "parity");
const FPS_MS = 1000 / 15;
const FRAMES = 10 * 60 * 15; // 9000 = 10 min @15fps (§7.6)
const P95_CEILING_MS = 3; // §7.6 CI tripwire; device ≤3ms (I5) verified at P5 §3.2
const HEAP_STRICT_MB = 5; // with forced GC (--expose-gc)
const HEAP_LOOSE_MB = 40; // natural GC: catches a real leak, tolerates GC noise

function build(): { def: ExerciseDefinition; frames: PoseFrame[] } {
  const def = exerciseDefinitionSchema.parse(
    JSON.parse(readFileSync(join(DEFS, "squat.json"), "utf8")),
  );
  const src = parseTrace(readFileSync(join(PARITY, "sqauta_sideview1goodform.jsonl"), "utf8")).frames;
  const frames: PoseFrame[] = [];
  for (let i = 0; i < FRAMES; i++) {
    const s = must(src[i % src.length]);
    frames.push({
      t: i * FPS_MS,
      kp: s.kp.map((k) => [...k] as [number, number, number, number]),
    });
  }
  return { def, frames };
}

describe("performance gate (§7.6 / I5)", () => {
  it(`p95 ≤ ${String(P95_CEILING_MS)}ms/frame and heap flat over ${String(FRAMES)} frames`, () => {
    const { def, frames } = build();

    // Warm-up pass (JIT + calibration) — not measured.
    const warm = createSession(compileDefinition(def, 1));
    for (const f of frames) warm.processFrame(f);
    warm.end();

    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const heapBefore = process.memoryUsage().heapUsed;

    const eng = createSession(compileDefinition(def, 1));
    const times = new Float64Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      const t0 = performance.now();
      eng.processFrame(must(frames[i]));
      times[i] = performance.now() - t0;
    }
    eng.end();

    gc?.();
    const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;

    const sorted = Array.from(times).sort((a, b) => a - b);
    const p95 = must(sorted[Math.floor(FRAMES * 0.95)]);
    const p50 = must(sorted[Math.floor(FRAMES * 0.5)]);
    const heapLimit = gc ? HEAP_STRICT_MB : HEAP_LOOSE_MB;

    console.warn(
      `ℹ perf: p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms heapΔ=${heapDeltaMb.toFixed(2)}MB ` +
        `gc=${gc ? "forced" : "natural"} (limit ${String(heapLimit)}MB)`,
    );

    expect(p95, `p95 ${p95.toFixed(4)}ms exceeded the ${String(P95_CEILING_MS)}ms CI tripwire`).toBeLessThanOrEqual(
      P95_CEILING_MS,
    );
    expect(
      heapDeltaMb,
      `heap grew ${heapDeltaMb.toFixed(2)}MB (limit ${String(heapLimit)}MB) — possible per-frame leak`,
    ).toBeLessThan(heapLimit);
  });
});
