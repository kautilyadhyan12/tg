// Part 2 §3.9 — emission & the set lifecycle. Assembles the full pipeline:
// ingest → conditioning/gate → view → signals → calibration → Mode-A FSM →
// faults → scoring → SetSummary. startSet = construct; feedFrame =
// processFrame; endSet = end() (idempotent). snapshot() returns plain JSON
// for the client shell's crash resilience (§3.9).
import type { FrameResult, PoseFrame, RepEvent, SetSummary } from "@app/shared";
import type { ReplayableEngine } from "./harness/types.js";
import { IngestStage } from "./pipeline/ingest.js";
import { VisibilityGate } from "./pipeline/conditioning.js";
import { ViewTracker, classifyView } from "./pipeline/view.js";
import { SignalEngine, type SignalName } from "./pipeline/signals.js";
import {
  AdaptiveTarget,
  StandingCalibration,
  type StandingBaseline,
} from "./pipeline/calibration.js";
import { ModeAFsm, type ModeAConfig } from "./pipeline/fsm.js";
import {
  FaultEvaluator,
  compileRules,
  type Aggregate,
  type EvalContext,
  type FaultRule,
} from "./pipeline/faults.js";
import { scoreRep, type ScoringComponent } from "./pipeline/scoring.js";

export const ENGINE_VERSION = "0.1.0"; // I4: stamped on every emitted session

/** Internal engine configuration — P1.7 compiles §4 definition documents into
 *  this shape; parity tests hand-build it from the §8.1 constants. */
export interface EngineConfig {
  exercise: string;
  setIndex: number;
  definitionVersion: number;
  /** Primary metric with legacy left→right fallback. */
  metric: SignalName;
  metricFallback?: SignalName;
  rep: ModeAConfig;
  /** Signals to compute each frame (I5: only these). */
  declaredSignals: readonly SignalName[];
  faultRules?: readonly FaultRule[];
  scoring?: readonly ScoringComponent[];
  scoreFloor?: number;
  /** Arm C1 (standing baseline capture). */
  useStandingBaseline?: boolean;
  /** Arm C2: metric extreme of first 2 reps → clamped target. */
  adaptiveTarget?: { clampLo: number; clampHi: number; fallback: number };
}

interface CycleAggregates {
  min: Record<string, number>;
  max: Record<string, number>;
  sum: Record<string, number>;
  n: Record<string, number>;
}

function emptyAggregates(): CycleAggregates {
  return { min: {}, max: {}, sum: {}, n: {} };
}

export function createSession(
  config: EngineConfig,
  carryOverCalibration?: StandingBaseline,
): ReplayableEngine & { snapshot(): Record<string, unknown> } {
  const ingest = new IngestStage();
  const gate = new VisibilityGate(33);
  const viewTracker = new ViewTracker();
  const declared: SignalName[] = [
    ...new Set<SignalName>([
      ...config.declaredSignals,
      config.metric,
      ...(config.metricFallback ? [config.metricFallback] : []),
      "knee_L",
      "knee_R",
      "knee_avg",
    ]),
  ];
  const signals = new SignalEngine(declared);
  const calibration = new StandingCalibration();
  if (carryOverCalibration) calibration.restore(carryOverCalibration);
  const adaptive = config.adaptiveTarget
    ? new AdaptiveTarget(
        config.adaptiveTarget.clampLo,
        config.adaptiveTarget.clampHi,
        config.adaptiveTarget.fallback,
      )
    : null;
  const fsm = new ModeAFsm(config.rep);
  const faults = new FaultEvaluator(
    compileRules(config.faultRules ?? [], [...declared, "target"]),
  );
  const scoringComponents = config.scoring ?? [];

  let repListener: ((e: RepEvent) => void) | undefined;
  const repEvents: RepEvent[] = [];
  const repScores: number[] = [];
  let severeInSet = false;
  let firstT: number | null = null;
  let lastT = 0;
  let aggregates = emptyAggregates();
  const romExtremes: number[] = [];
  let ended: SetSummary | null = null;
  let lastFrameSignals: Partial<Record<SignalName, number | null>> = {};

  function trackAggregates(values: Partial<Record<SignalName, number | null>>): void {
    for (const [name, v] of Object.entries(values)) {
      if (v === null || v === undefined) continue;
      aggregates.min[name] = Math.min(aggregates.min[name] ?? Number.POSITIVE_INFINITY, v);
      aggregates.max[name] = Math.max(aggregates.max[name] ?? Number.NEGATIVE_INFINITY, v);
      aggregates.sum[name] = (aggregates.sum[name] ?? 0) + v;
      aggregates.n[name] = (aggregates.n[name] ?? 0) + 1;
    }
  }

  function evalCtx(): EvalContext {
    return {
      frame: (name) => lastFrameSignals[name as SignalName] ?? null,
      aggregate: (name, agg: Aggregate) => {
        if (agg === "min") return aggregates.min[name] ?? null;
        if (agg === "max") return aggregates.max[name] ?? null;
        const s = aggregates.sum[name];
        const n = aggregates.n[name];
        return s !== undefined && n !== undefined && n > 0 ? s / n : null;
      },
      target: () => adaptive?.target ?? null,
    };
  }

  /** Aggregate lookup for scoring inputs like "knee_avg_min". */
  function scoringInput(input: string): number | null {
    const m = /^(.*)_(min|max|avg)$/.exec(input);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      return evalCtx().aggregate(m[1], m[2] as Aggregate);
    }
    return lastFrameSignals[input as SignalName] ?? null;
  }

  function processFrame(frame: PoseFrame): FrameResult {
    const accepted = ingest.accept(frame);
    lastT = frame.t;
    firstT ??= frame.t;
    if (!accepted.ok) {
      return {
        phase: "top",
        repCount: fsm.reps,
        isActive: false,
        view: viewTracker.view,
        visibilityOk: accepted.visibilityOk,
        liveCue: accepted.visibilityOk ? null : "cue.visibility.step_back",
        signals: {},
        calibrationState: calibration.ready || config.useStandingBaseline !== true ? "ready" : "pending",
      };
    }

    frame.kp.forEach((k, i) => gate.update(i, k[3]));
    const view = viewTracker.update(classifyView(frame, gate));
    const values = signals.compute(frame, gate, calibration.baseline);
    lastFrameSignals = values;
    trackAggregates(values);

    if (config.useStandingBaseline === true) {
      calibration.update(
        frame,
        gate,
        values.knee_avg ?? null,
        view,
        accepted.visibilityOk,
        values.valgus_L ?? null,
        values.valgus_R ?? null,
      );
    }

    const metric = values[config.metric] ?? (config.metricFallback ? values[config.metricFallback] : null) ?? null;
    // Bilateral gate input: the OTHER knee, only when both visible (legacy).
    const kneeL = values.knee_L ?? null;
    const kneeR = values.knee_R ?? null;
    const bothVisible = kneeL !== null && kneeR !== null;
    const other = bothVisible ? (config.metric === "knee_L" ? kneeR : kneeL) : null;

    const fsmResult = fsm.update(frame.t, metric, other);

    const frameFaults = faults.evaluateFrame(frame.t, view, fsmResult.phase, evalCtx());

    if (fsmResult.completed) {
      const repFaults = faults.evaluateRep(view, evalCtx());
      const rep = scoreRep(scoringComponents, scoringInput, repFaults.severe, config.scoreFloor);
      if (repFaults.severe) severeInSet = true;
      repScores.push(rep.score);
      romExtremes.push(fsmResult.completed.romExtreme);
      adaptive?.onRepComplete(fsmResult.completed.romExtreme);
      const event: RepEvent = {
        repIndex: fsmResult.completed.repIndex,
        score: rep.score,
        faults: repFaults.faults,
        durationMs: Math.round(fsmResult.completed.durationMs),
        phaseTimings: {
          descent: Math.round(fsmResult.completed.phaseTimings.descent),
          bottom: Math.round(fsmResult.completed.phaseTimings.bottom),
          ascent: Math.round(fsmResult.completed.phaseTimings.ascent),
        },
        romExtreme: fsmResult.completed.romExtreme,
        view,
      };
      repEvents.push(event);
      repListener?.(event);
      aggregates = emptyAggregates(); // rep-scoped aggregates reset per cycle
    }

    const calibrationState =
      config.useStandingBaseline === true && !calibration.ready ? "pending" : "ready";

    return {
      phase: fsmResult.phase,
      repCount: fsmResult.repCount,
      isActive: fsmResult.isActive,
      view,
      visibilityOk: accepted.visibilityOk,
      liveCue: frameFaults.voiceCue,
      signals: Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== null),
      ) as Record<string, number>,
      calibrationState,
    };
  }

  function end(): SetSummary {
    if (ended) return ended; // §3.9: endSet is idempotent
    const avg =
      repScores.length > 0
        ? Math.round(repScores.reduce((a, b) => a + b, 0) / repScores.length)
        : null;
    const tempos = repEvents.map((r) => r.durationMs);
    ended = {
      exercise: config.exercise,
      setIndex: config.setIndex,
      reps: fsm.reps,
      durationMs: Math.round(lastT - (firstT ?? lastT)),
      avgFormScore: avg,
      repScores,
      faultCounts: { ...faults.faultCounts },
      tempoMsAvg:
        tempos.length > 0
          ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
          : null,
      romStats:
        romExtremes.length > 0
          ? {
              metricMinAvg: Math.round(
                (romExtremes.reduce((a, b) => a + b, 0) / romExtremes.length) * 10,
              ) / 10,
            }
          : null,
      view: viewTracker.view,
      holdMs: null, // Mode A; isometrics land in P1.6b
      calibration: {
        usedStandingBaseline: config.useStandingBaseline === true && calibration.ready,
        chairDepthTarget: adaptive?.calibrated === true ? adaptive.target : null,
      },
      engineVersion: ENGINE_VERSION,
      definitionVersion: config.definitionVersion,
    };
    return ended;
  }

  return {
    processFrame,
    end,
    onRep(listener) {
      repListener = listener;
    },
    snapshot() {
      // Plain-JSON state for the client shell's 5-s crash checkpoint (§3.9).
      return {
        engineVersion: ENGINE_VERSION,
        exercise: config.exercise,
        setIndex: config.setIndex,
        reps: fsm.reps,
        repScores: [...repScores],
        faultCounts: { ...faults.faultCounts },
        severeInSet,
        calibrationReady: calibration.ready,
        lastT,
      };
    },
  };
}
