// Hand-built EngineConfigs for the three parity exercises. Every number cites
// its §8.1 constant-preservation row / rep_counter.py config. P1.7 replaces
// these with compiled §4 definition documents; P1.8b must reproduce them from
// the approved constants table.
import type { EngineConfig } from "../src/index.js";

const squatScoring = [
  {
    component: "depth",
    input: "knee_avg_min",
    curve: [[100, 100], [130, 30], [155, 0]] as [number, number][], // §8.1 depth curve / §3.8
    inactiveAbove: 155,
  },
  {
    component: "trunk",
    input: "trunk_incline_max",
    curve: [[45, 100], [75, 0]] as [number, number][], // §8.1 trunk / §3.8
  },
];

export function parityConfig(exercise: string): EngineConfig {
  switch (exercise) {
    case "squat":
      return {
        exercise,
        setIndex: 1,
        definitionVersion: 0,
        metric: "knee_L", // rep_counter joint "left_knee"
        metricFallback: "knee_R",
        rep: { mode: "alternating_threshold", upAt: 160, downAt: 100, countOn: "up", bilateralGate: true }, // §8.1 squat 160/100
        declaredSignals: ["knee_L", "knee_R", "knee_avg", "trunk_incline"],
        scoring: squatScoring,
      };
    case "jump_squat":
      return {
        exercise,
        setIndex: 1,
        definitionVersion: 0,
        metric: "knee_L",
        metricFallback: "knee_R",
        rep: { mode: "alternating_threshold", upAt: 160, downAt: 130, countOn: "up", bilateralGate: true }, // §8.1 jump 130
        declaredSignals: ["knee_L", "knee_R", "knee_avg", "trunk_incline"],
        scoring: squatScoring,
      };
    case "chair_squat":
      return {
        exercise,
        setIndex: 1,
        definitionVersion: 0,
        metric: "knee_L",
        metricFallback: "knee_R",
        rep: { mode: "alternating_threshold", upAt: 155, downAt: 110, countOn: "up", bilateralGate: true }, // §8.1 chair 155/110
        declaredSignals: ["knee_L", "knee_R", "knee_avg", "trunk_incline"],
        scoring: squatScoring,
        adaptiveTarget: { clampLo: 80, clampHi: 120, fallback: 100 }, // §8.1 CHAIR fallback/clamp (§3.5)
      };
    default:
      throw new Error(`no parity config for exercise "${exercise}"`);
  }
}
