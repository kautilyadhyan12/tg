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

export const ENGINE_VERSION = "1.0.0"; // I4: semver of the package, stamped on every emitted session (P1 = engine v1, Part 2 §10)

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
  /** Parallel to repEvents: was the camera unable to watch part of that rep?
   *  Kept beside the events rather than inside them — RepEvent is a §2.4
   *  payload shape and this fix changes no payload shape. */
  const repInterrupted: boolean[] = [];
  const repScores: number[] = [];
  let severeInSet = false;
  let firstT: number | null = null;
  let lastT = 0;
  // ── WATCHED TIME (the API half of the rep-timing card) ──────────────────
  // How much of this set the camera could actually watch. The server bills
  // from it. Time accrues ONLY between two frames the engine could use, with
  // no loss of sight in between; `durationMs` (first frame → last frame) is
  // the whole set including the stretches nobody watched, and this is the rest.
  //
  // No new threshold is invented for "how long a gap is an absence": the gap
  // is exactly the one §3.1's count of three already defines, funnelled
  // through `fsm.loseSight()` from both of its enforcement sites. So watched
  // time and the rep clock re-arm on the same frame, by construction.
  //
  // WHAT THIS NUMBER CANNOT SEE, stated because the first draft of this
  // comment claimed it could ("can never exceed what was really seen") and
  // that was FALSE. A PAUSE feeds no frames AT ALL — not blank ones, not
  // unusable ones — while the timestamps inside the frames that resume have
  // advanced. One long inter-frame gap is indistinguishable here from a slow
  // camera, so a pause lands INSIDE watched time. Measured on this package's
  // own clip with a 120 s pause swept across every frame boundary: 70 of 84
  // positions report `watchedMs` 128,400 against 8,400 ms really watched, and
  // the worst bills 14.82 kcal where the truth is 0.98.
  //
  // That is PRE-EXISTING — v2 bills the identical 127,000 ms on the same
  // clips — and the server clamps it with the on-screen timer, which is the
  // one measurement that does stop on pause. The real fix is for the client to
  // TELL the engine it stopped feeding; that needs no new threshold either,
  // and it has its own `OWED.md` line rather than being smuggled in here.
  let watchedMs = 0;
  let lastUsableT: number | null = null;
  let blindSinceLastUsable = false;
  let aggregates = emptyAggregates();
  const romExtremes: number[] = [];
  let ended: SetSummary | null = null;
  let lastFrameSignals: Partial<Record<SignalName, number | null>> = {};
  let prevPhase = "top"; // cycle-window tracking (aggregates scope to a cycle)

  /** §2.4: FrameResult carries only the DECLARED signals (the session's
   *  internal additions — knee_L/R for the bilateral gate — stay internal). */
  function emittedSignals(
    values: Partial<Record<SignalName, number | null>>,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of config.declaredSignals) {
      const v = values[name];
      if (typeof v === "number") out[name] = v;
    }
    return out;
  }

  function trackAggregates(values: Partial<Record<SignalName, number | null>>): void {
    for (const [name, v] of Object.entries(values)) {
      if (typeof v !== "number") continue;
      aggregates.min[name] = Math.min(aggregates.min[name] ?? Number.POSITIVE_INFINITY, v);
      aggregates.max[name] = Math.max(aggregates.max[name] ?? Number.NEGATIVE_INFINITY, v);
      aggregates.sum[name] = (aggregates.sum[name] ?? 0) + v;
      aggregates.n[name] = (aggregates.n[name] ?? 0) + 1;
    }
  }

  // Widened read view over the per-frame signal map: string-keyed lookups
  // (DSL refs, scoring inputs) without casts.
  const frameValue = (name: string): number | null => {
    const map: Readonly<Partial<Record<string, number | null>>> = lastFrameSignals;
    return map[name] ?? null;
  };
  const isDeclared = (name: string): boolean =>
    (declared as readonly string[]).includes(name);

  function evalCtx(): EvalContext {
    return {
      frame: frameValue,
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

  /** Scoring-input lookup. The _(min|max|avg) suffix is an aggregate ONLY when
   *  the base is a declared signal — otherwise a plain signal whose own name
   *  ends in _avg (knee_avg) would silently resolve to aggregate("knee","avg")
   *  = null and deactivate its component (T3 finding; §9.2 linter will also
   *  reject ambiguous names at authoring time). */
  function scoringInput(input: string): number | null {
    const m = /^(.*)_(min|max|avg)$/.exec(input);
    const base = m?.[1];
    const agg = m?.[2];
    if (base !== undefined && (agg === "min" || agg === "max" || agg === "avg") && isDeclared(base)) {
      return evalCtx().aggregate(base, agg);
    }
    return frameValue(input);
  }

  function processFrame(frame: PoseFrame): FrameResult {
    const accepted = ingest.accept(frame);
    lastT = frame.t;
    firstT ??= frame.t;
    if (!accepted.ok) {
      // §3.1's visibility streak has tripped — three frames running that the
      // engine cannot use (in production: `feed([], t)` from a blocked or
      // person-check-silenced frame). The rep in progress keeps its state and
      // still counts; only its CLOCK re-arms, so the stretch nobody could watch
      // is never billed as exercise. Out-of-order drops leave visibilityOk
      // alone by design (DECISIONS 2026-07-07), so they cannot trip this.
      if (!accepted.visibilityOk) {
        fsm.loseSight();
        blindSinceLastUsable = true;
      }
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

    // The frame is USABLE when the rep metric resolved — the same test the rep
    // clock runs on. Credit the stretch since the last usable frame unless the
    // camera lost sight inside it, then re-anchor here.
    //
    // A gap of one or two unusable frames is NOT an absence (§3.1 needs three),
    // so it stays inside watched time — which is right, because the rep clock
    // runs through it too. The two must agree, or the set can bill more rep
    // time than it claims to have watched.
    if (metric !== null) {
      if (lastUsableT !== null && !blindSinceLastUsable) watchedMs += frame.t - lastUsableT;
      blindSinceLastUsable = false;
      lastUsableT = frame.t;
    }

    const fsmResult = fsm.update(frame.t, metric, other);

    // The OTHER blindness: every frame arrives and is valid, the legs simply
    // are not measurable (:7404 measured it at the same size as walking out of
    // shot). The FSM owns that streak, so ask it rather than counting again.
    if (metric === null && fsm.sightLost) blindSinceLastUsable = true;

    // Rep-aggregate window = the CYCLE (descent begin → completion), not
    // wall-to-wall frames: standing-around between reps must not leak into the
    // next rep's _max aggregates (T3 finding; §3.6 "at bottom" semantics).
    if (prevPhase === "top" && fsmResult.phase !== "top") {
      aggregates = emptyAggregates();
      trackAggregates(values); // this frame starts the new cycle
    }
    prevPhase = fsmResult.phase;

    const frameFaults = faults.evaluateFrame(frame.t, view, fsmResult.phase, evalCtx());

    if (fsmResult.completed) {
      const repFaults = faults.evaluateRep(view, evalCtx());
      const rep = scoreRep(scoringComponents, scoringInput, repFaults.severe, config.scoreFloor, view);
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
      repInterrupted.push(fsmResult.completed.interrupted);
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
      signals: emittedSignals(values),
      calibrationState,
    };
  }

  function end(): SetSummary {
    if (ended) return ended; // §3.9: endSet is idempotent
    const avg =
      repScores.length > 0
        ? Math.round(repScores.reduce((a, b) => a + b, 0) / repScores.length)
        : null;
    // A rep the camera only half-watched carries the WATCHED remainder as its
    // duration — honest, but shorter than the rep really took. Averaging it in
    // would drag the tempo down and UNDER-bill every rep in the set, because
    // `reps × tempoMsAvg` is what the server charges: an over-count traded for
    // a quieter under-count (Kd found this in the one-part design, 2026-08-11).
    // So the average is taken over the reps watched END TO END, and nothing
    // else. `tempoMsAvg` means "how long a rep took", and a rep the camera
    // half-saw is not an answer to that question.
    //
    // THE PART-MEASURED FALLBACK IS GONE — Kd ruled it out on 2026-08-14 and
    // this supersedes his 2026-08-11 wording ("the part-measured reps still set
    // the rate"). That clause was a workaround for a missing number, and it was
    // the one place his own part 2 was inverted: it let half-measured reps set
    // the rate after all, which billed an all-interrupted set ~20% low
    // (:7487). The number now exists — `watchedMs`, below — so the honest
    // answer to "how long did a rep take" is that we do not know, and the
    // server charges the time the camera actually watched instead. Reporting
    // null used to bill LESS than the fallback (measured: honest 10 kcal ·
    // fallback 8 · null 6 through the real `kcalPointForSetsV2`); under the
    // formula that reads `watchedMs` it does not, which is exactly what made
    // the fallback removable rather than merely undesirable.
    //
    // The zero-duration rep this fallback used to have to exclude by hand
    // (sight returning on the very frame a rep completes: `t - t`) needs no
    // special case now — it is interrupted, so it was never a candidate.
    const tempos = repEvents.filter((_, i) => repInterrupted[i] !== true).map((r) => r.durationMs);
    ended = {
      exercise: config.exercise,
      setIndex: config.setIndex,
      reps: fsm.reps,
      durationMs: Math.round(lastT - (firstT ?? lastT)),
      // Never more than the span by construction: it accrues only between
      // frames inside [firstT, lastT]. Asserted rather than assumed.
      watchedMs: Math.round(watchedMs),
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
