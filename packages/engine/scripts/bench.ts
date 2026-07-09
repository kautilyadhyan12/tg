// Perf benchmark (Part 2 §7.6 / I5). Node-side shell — outside the engine's
// pure runtime boundary, so process/console/performance are fine here. Replays
// a real golden looped to 10 minutes (@15fps) through the REAL pipeline and
// reports p50/p95 per-frame cost and heap delta. The asserting CI gate lives in
// test/perf.test.ts; this script is the human-readable readout (`pnpm bench`).
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exerciseDefinitionSchema, type PoseFrame } from "@app/shared";
import { compileDefinition, createSession, parseTrace, type ReplayableEngine } from "../src/index.js";

const FRAMES = 10 * 60 * 15; // 9000
const FPS_MS = 1000 / 15;

const def = exerciseDefinitionSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "../test/definitions/squat.json"), "utf8")),
);
const src = parseTrace(
  readFileSync(join(import.meta.dirname, "../test/traces/parity/sqauta_sideview1goodform.jsonl"), "utf8"),
).frames;

const frames: PoseFrame[] = [];
for (let i = 0; i < FRAMES; i++) {
  const s = src[i % src.length];
  if (s === undefined) continue;
  frames.push({ t: i * FPS_MS, kp: s.kp.map((k) => [...k] as [number, number, number, number]) });
}

function buildEngine(): ReplayableEngine {
  return createSession(compileDefinition(def, 1));
}

const heapBefore = process.memoryUsage().heapUsed;
const perFrameMs: number[] = [];

// Warm-up pass, then measured pass.
const warm = buildEngine();
for (const f of frames) warm.processFrame(f);
warm.end();

const engine = buildEngine();
for (const frame of frames) {
  const t0 = performance.now();
  engine.processFrame(frame);
  perFrameMs.push(performance.now() - t0);
}
engine.end();

perFrameMs.sort((a, b) => a - b);
const p95 = perFrameMs[Math.floor(perFrameMs.length * 0.95)] ?? 0;
const p50 = perFrameMs[Math.floor(perFrameMs.length * 0.5)] ?? 0;
const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;

console.log(`frames: ${String(perFrameMs.length)} (real squat engine, looped golden)`);
console.log(`p50 per-frame: ${p50.toFixed(4)} ms`);
console.log(`p95 per-frame: ${p95.toFixed(4)} ms  (§7.6 CI tripwire ≤3 ms; device budget I5 verified at P5 §3.2)`);
console.log(`heap delta: ${heapDeltaMb.toFixed(2)} MB`);
