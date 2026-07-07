// Perf benchmark scaffold (Part 2 §7.6 / I5). Node-side shell — outside the
// engine's pure runtime boundary, so process/console/performance are fine here.
// Replays a synthetic 10-minute 15 fps trace in a tight loop and reports p95
// per-frame cost and heap delta. The ≤3 ms p95 CI assertion activates in P1.9
// once a real engine exists; until then this prints scaffold numbers.
import { performance } from "node:perf_hooks";
import { replay, type ReplayableEngine } from "../src/index.js";
import { makeTrace, scriptedEngine } from "../test/fixtures.js";

const TEN_MINUTES_AT_15FPS = 10 * 60 * 15; // 9000 frames

function buildEngine(): ReplayableEngine {
  // P1.4–P1.6 swap this for the real pipeline factory.
  return scriptedEngine({ repAtFrames: [], repScores: [], faultCounts: {} });
}

const trace = makeTrace(TEN_MINUTES_AT_15FPS);
const heapBefore = process.memoryUsage().heapUsed;
const perFrameMs: number[] = [];

// Warm-up pass, then measured pass.
replay(buildEngine(), trace);
const engine = buildEngine();
for (const frame of trace.frames) {
  const t0 = performance.now();
  engine.processFrame(frame);
  perFrameMs.push(performance.now() - t0);
}
engine.end();

perFrameMs.sort((a, b) => a - b);
const p95 = perFrameMs[Math.floor(perFrameMs.length * 0.95)] ?? 0;
const p50 = perFrameMs[Math.floor(perFrameMs.length * 0.5)] ?? 0;
const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;

console.log(`frames: ${String(perFrameMs.length)}`);
console.log(`p50 per-frame: ${p50.toFixed(4)} ms`);
console.log(`p95 per-frame: ${p95.toFixed(4)} ms  (I5 budget: ≤ 3 ms on mid-Android; CI assertion arms in P1.9)`);
console.log(`heap delta: ${heapDeltaMb.toFixed(2)} MB`);
console.log("NOTE: scaffold engine only — numbers become meaningful when the real pipeline lands (P1.4+).");
