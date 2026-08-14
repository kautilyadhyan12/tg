// Shared test fixtures: synthetic traces + a scripted fake engine.
// The fake engine emits pre-programmed behavior so every §7.4 assertion can be
// exercised in both passing and failing directions before a real engine exists.
import type { FrameResult, PoseFrame, RepEvent, SetSummary } from "@app/shared";
import type { ReplayableEngine, Trace, TraceHeader } from "../src/index.js";
import { ENGINE_VERSION } from "../src/index.js";

/** Definite-index access for fixtures (tests ban non-null assertions). */
export function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("fixture index out of range");
  return v;
}

export function makeFrames(count: number, fpsMs = 66.7): PoseFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    t: i * fpsMs,
    kp: Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.9] as [number, number, number, number]),
  }));
}

export function makeHeader(overrides: Partial<TraceHeader> = {}): TraceHeader {
  return {
    traceVersion: 1,
    exercise: "squat",
    recordedWith: { engine: "1.0.0", defs: 1 },
    device: "test-rig",
    platform: "web",
    fps: 15,
    view: "side",
    label: "synthetic",
    expected: { reps: 2, faultsExact: {}, scoreRange: [80, 95], formCorrectAll: true },
    ...overrides,
  };
}

export function makeTrace(frameCount = 30, overrides: Partial<TraceHeader> = {}): Trace {
  return { header: makeHeader(overrides), frames: makeFrames(frameCount) };
}

export interface ScriptedBehavior {
  /** frame index (0-based) → rep credited at that frame */
  repAtFrames: number[];
  repScores: number[];
  faultCounts: Record<string, number>;
  holdMs?: number | null;
  phaseByFrame?: (i: number) => string;
}

export function scriptedEngine(script: ScriptedBehavior): ReplayableEngine {
  let repListener: ((e: RepEvent) => void) | undefined;
  let frameIndex = 0;
  let reps = 0;
  return {
    onRep(l) {
      repListener = l;
    },
    /** A scripted engine has no clock to re-arm — its reps are a list of frame
     *  indices. Present because the CONTRACT requires it (that is the point of
     *  putting it on `EngineSession`: no implementation gets to be silently
     *  unaware of the question), and a no-op because there is honestly nothing
     *  here to move. The harness never calls it. */
    loseSight() {
      // intentionally nothing — see above
    },
    processFrame(frame): FrameResult {
      const i = frameIndex++;
      if (script.repAtFrames.includes(i)) {
        reps++;
        repListener?.({
          repIndex: reps,
          score: script.repScores[reps - 1] ?? 0,
          faults: [],
          durationMs: 2000,
          phaseTimings: { descent: 800, bottom: 400, ascent: 800 },
          romExtreme: 95,
          view: "side",
        });
      }
      return {
        phase: script.phaseByFrame?.(i) ?? "idle",
        repCount: reps,
        isActive: true,
        view: "side",
        visibilityOk: true,
        liveCue: null,
        signals: { t: frame.t },
        calibrationState: "ready",
      };
    },
    end(): SetSummary {
      const scores = script.repScores.slice(0, reps);
      const avg =
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : null;
      return {
        exercise: "squat",
        setIndex: 1,
        reps,
        durationMs: 60000,
        avgFormScore: avg,
        repScores: scores,
        faultCounts: script.faultCounts,
        tempoMsAvg: 3000,
        romStats: { metricMinAvg: 95 },
        view: "side",
        holdMs: script.holdMs ?? null,
        calibration: null,
        engineVersion: ENGINE_VERSION,
        definitionVersion: 1,
      };
    },
  };
}
