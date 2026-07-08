// §4 definition document → the session's internal EngineConfig. Definitions
// are data (I3/R5.6): this is the ONLY place a document becomes engine
// behavior, and it assumes the linter already passed (createSession throws on
// a bad document only because the linter is the real gate — §9.2).
import type { ExerciseDefinition } from "@app/shared";
import type { EngineConfig } from "../session.js";
import type { SignalName } from "../pipeline/signals.js";
import type { FaultRule } from "../pipeline/faults.js";
import type { ScoringComponent } from "../pipeline/scoring.js";
import { NotImplementedError } from "../pipeline/fsm.js";
import { BILATERAL_ENGAGE_ANGLE } from "../pipeline/fsm.js";

export class DefinitionCompileError extends Error {
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "DefinitionCompileError";
  }
}

/** Scoring input `abs(x)` → { input: x, absolute: true } (worked example §4). */
function compileScoring(def: ExerciseDefinition): ScoringComponent[] | undefined {
  const comps = def.scoring?.components;
  if (!comps) return undefined;
  return comps.map((c) => {
    const absMatch = /^abs\((.+)\)$/.exec(c.input);
    return {
      component: c.component,
      input: absMatch?.[1] ?? c.input,
      curve: c.curve.map(([x, y]) => [x, y] as [number, number]),
      ...(absMatch ? { absolute: true } : {}),
      ...(c.inactiveAbove !== undefined ? { inactiveAbove: c.inactiveAbove } : {}),
      ...(c.inactiveWhenPositiveDrift === true ? { inactiveWhenPositiveDrift: true } : {}),
    };
  });
}

export function compileDefinition(
  def: ExerciseDefinition,
  setIndex: number,
): EngineConfig {
  if (def.tracking === "timer") {
    throw new DefinitionCompileError("tracking", "timer definitions have no engine session");
  }
  const rep = def.rep;
  if (!rep) throw new DefinitionCompileError("rep", "missing rep block");
  if (rep.mode !== "alternating_threshold") {
    throw new NotImplementedError(`rep.mode "${rep.mode}"`);
  }
  if (rep.metric === undefined || rep.upAt === undefined || rep.downAt === undefined) {
    throw new DefinitionCompileError("rep", "Mode A requires metric/upAt/downAt");
  }
  if (rep.bilateralGate !== undefined && rep.bilateralGate !== BILATERAL_ENGAGE_ANGLE) {
    // The engage angle is engine-global (§8.1: 150). A definition asking for a
    // different one is a template gap, not a silent override (R5.6).
    throw new DefinitionCompileError(
      "rep.bilateralGate",
      `only the engine-global ${String(BILATERAL_ENGAGE_ANGLE)} is supported in v1`,
    );
  }

  const scoring = compileScoring(def);
  // Re-shape shared fault rules: drop explicitly-undefined optionals so the
  // object satisfies exactOptionalPropertyTypes without casts.
  const faultRules: FaultRule[] | undefined = def.faults?.map((f) => ({
    id: f.id,
    when: f.when,
    severity: f.severity,
    msg: f.msg,
    sustainMs: f.sustainMs,
    ...(f.view !== undefined ? { view: f.view } : {}),
    ...(f.phase !== undefined ? { phase: f.phase } : {}),
    ...(f.perRep !== undefined ? { perRep: f.perRep } : {}),
    ...(f.severe !== undefined ? { severe: f.severe } : {}),
    ...(f.cueCooldownMs !== undefined ? { cueCooldownMs: f.cueCooldownMs } : {}),
  }));
  const adaptive = def.calibration?.find((c) => c.module === "adaptive_target");
  const metric: SignalName = rep.metric;
  // Legacy left→right fallback pairs (rep_counter joint.replace("left_","right_")).
  const fallback: SignalName | undefined =
    metric === "knee_L" ? "knee_R" : metric === "elbow_L" ? "elbow_R" : undefined;

  return {
    exercise: def.key,
    setIndex,
    definitionVersion: def.version,
    metric,
    ...(fallback ? { metricFallback: fallback } : {}),
    rep: {
      mode: "alternating_threshold",
      upAt: rep.upAt,
      downAt: rep.downAt,
      countOn: rep.countOn ?? "up",
      ...(rep.minRepMs !== undefined ? { minRepMs: rep.minRepMs } : {}),
      ...(rep.maxRepMs !== undefined ? { maxRepMs: rep.maxRepMs } : {}),
      bilateralGate: rep.bilateralGate !== undefined,
    },
    declaredSignals: def.signals ?? [],
    ...(faultRules ? { faultRules } : {}),
    ...(scoring ? { scoring } : {}),
    ...(def.scoring?.floor !== undefined ? { scoreFloor: def.scoring.floor } : {}),
    useStandingBaseline: def.calibration?.some((c) => c.module === "standing_baseline") === true,
    ...(adaptive?.module === "adaptive_target"
      ? {
          adaptiveTarget: {
            clampLo: adaptive.clamp[0],
            clampHi: adaptive.clamp[1],
            fallback: adaptive.fallback,
          },
        }
      : {}),
  };
}
