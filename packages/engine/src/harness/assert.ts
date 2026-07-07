// Part 2 §7.4 — assertions & tolerances, verbatim:
//   rep count EXACT · fault multiset EXACT (clean ⇒ empty) · scores within the
//   trace's declared scoreRange · hold time ±700 ms · phase sequences optional.
// A failing assertion names the FIRST DIVERGENT FRAME — debugging is "open
// frame 412", not archaeology.
import type { ReplayResult } from "./types.js";
import type { Trace } from "./trace.js";

export const HOLD_TOLERANCE_MS = 700; // §7.4

export interface TraceFailure {
  kind: "reps" | "faults" | "score" | "hold" | "phaseSequence";
  message: string;
  /** 1-based index of the first frame where behavior diverged, when locatable. */
  firstDivergentFrame?: number;
}

/** First frame whose repCount exceeded the expected total (over-count), or
 *  the last frame if the engine under-counted (divergence = never got there). */
function locateRepDivergence(result: ReplayResult, expectedReps: number): number {
  const over = result.frameResults.findIndex((f) => f.repCount > expectedReps);
  if (over !== -1) return over + 1;
  return result.frameResults.length;
}

export function assertTrace(trace: Trace, result: ReplayResult): TraceFailure[] {
  const failures: TraceFailure[] = [];
  const expected = trace.header.expected;

  // Rep count: exact (I2 — integer outputs bit-for-bit).
  if (result.summary.reps !== expected.reps) {
    failures.push({
      kind: "reps",
      message: `reps: expected ${String(expected.reps)}, got ${String(result.summary.reps)}`,
      firstDivergentFrame: locateRepDivergence(result, expected.reps),
    });
  }

  // Fault multiset: exact; clean traces assert empty.
  const got = result.summary.faultCounts;
  const want = expected.faultsExact;
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const k of keys) {
    const g = got[k] ?? 0;
    const w = want[k] ?? 0;
    if (g !== w) {
      failures.push({
        kind: "faults",
        message: `fault '${k}': expected ${String(w)}, got ${String(g)}`,
      });
    }
  }

  // Scores: within the declared scoreRange (authoring slack lives in the range).
  const [lo, hi] = expected.scoreRange;
  const avg = result.summary.avgFormScore;
  if (avg !== null && (avg < lo || avg > hi)) {
    failures.push({
      kind: "score",
      message: `avgFormScore ${String(avg)} outside declared range [${String(lo)}, ${String(hi)}]`,
    });
  }
  if (avg === null && expected.reps > 0 && expected.formCorrectAll) {
    failures.push({ kind: "score", message: "avgFormScore is null on a scored trace" });
  }

  // Hold time: ±700 ms (§7.4).
  if (expected.holdMs !== undefined) {
    const gotHold = result.summary.holdMs;
    if (gotHold === null) {
      failures.push({ kind: "hold", message: "holdMs is null on an isometric trace" });
    } else if (Math.abs(gotHold - expected.holdMs) > HOLD_TOLERANCE_MS) {
      failures.push({
        kind: "hold",
        message: `holdMs ${String(gotHold)} not within ±${String(HOLD_TOLERANCE_MS)} of ${String(expected.holdMs)}`,
      });
    }
  }

  // Phase sequence: optional, FSM-sensitive traces only.
  if (expected.phaseSequence !== undefined) {
    const observed: string[] = [];
    for (const f of result.frameResults) {
      if (observed[observed.length - 1] !== f.phase) observed.push(f.phase);
    }
    const wantSeq = expected.phaseSequence;
    let divergentIdx: number | undefined;
    let cursor = 0;
    for (let i = 0; i < result.frameResults.length; i++) {
      const phase = result.frameResults[i]?.phase;
      if (phase === wantSeq[cursor + 1]) cursor++;
      else if (phase !== wantSeq[cursor]) {
        divergentIdx = i + 1;
        break;
      }
    }
    if (divergentIdx !== undefined || cursor < wantSeq.length - 1) {
      failures.push({
        kind: "phaseSequence",
        message: `phase sequence diverged: expected ${wantSeq.join("→")}, observed ${observed.join("→")}`,
        ...(divergentIdx !== undefined ? { firstDivergentFrame: divergentIdx } : {}),
      });
    }
  }

  return failures;
}

export function formatFailures(traceLabel: string, failures: TraceFailure[]): string {
  return failures
    .map((f) => {
      const frame =
        f.firstDivergentFrame !== undefined
          ? ` (first divergent frame: ${String(f.firstDivergentFrame)})`
          : "";
      return `[${traceLabel}] ${f.kind}: ${f.message}${frame}`;
    })
    .join("\n");
}
