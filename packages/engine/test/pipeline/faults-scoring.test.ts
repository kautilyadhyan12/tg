// DSL parser/evaluator (§3.7) + scoring (§3.8) tests.
import { describe, expect, it } from "vitest";
import {
  CORRECT_AT,
  DslParseError,
  FaultEvaluator,
  NEUTRAL_SCORE,
  compileRules,
  evaluate,
  evaluateCurve,
  parseCondition,
  scoreRep,
  sessionFormScore,
  type EvalContext,
} from "../../src/index.js";

const SIGNALS = ["knee_avg", "trunk_incline", "valgus_delta_L", "valgus_delta"];

function ctx(frame: Record<string, number | null>, aggs: Record<string, number> = {}, target: number | null = null): EvalContext {
  return {
    frame: (n) => frame[n] ?? null,
    aggregate: (n, a) => aggs[`${n}_${a}`] ?? null,
    target: () => target,
  };
}

describe("DSL parser (§3.7 grammar, parse-once)", () => {
  it("parses comparisons, && || and parens with precedence", () => {
    const e = parseCondition("(knee_avg < 100 || trunk_incline > 45) && valgus_delta_L < -0.15", SIGNALS);
    expect(evaluate(e, ctx({ knee_avg: 90, trunk_incline: 10, valgus_delta_L: -0.2 }))).toBe(true);
    expect(evaluate(e, ctx({ knee_avg: 120, trunk_incline: 10, valgus_delta_L: -0.2 }))).toBe(false);
  });
  it("aggregates: knee_avg_min > 130 (the shallow-depth check)", () => {
    const e = parseCondition("knee_avg_min > 130", SIGNALS);
    expect(evaluate(e, ctx({}, { knee_avg_min: 140 }))).toBe(true);
    expect(evaluate(e, ctx({}, { knee_avg_min: 95 }))).toBe(false);
  });
  it("calibration ref: knee_avg_min > target + 25 (chair shallow-margin)", () => {
    const e = parseCondition("knee_avg_min > target + 25", SIGNALS);
    expect(evaluate(e, ctx({}, { knee_avg_min: 130 }, 100))).toBe(true);
    expect(evaluate(e, ctx({}, { knee_avg_min: 120 }, 100))).toBe(false);
  });
  it("null signal ⇒ null result (no decision, I6)", () => {
    const e = parseCondition("trunk_incline > 45", SIGNALS);
    expect(evaluate(e, ctx({ trunk_incline: null }))).toBeNull();
  });
  it("rejects unknown signals and malformed input at parse time", () => {
    expect(() => parseCondition("made_up > 3", SIGNALS)).toThrow(DslParseError);
    expect(() => parseCondition("knee_avg >", SIGNALS)).toThrow(DslParseError);
    expect(() => parseCondition("knee_avg > 100 extra", SIGNALS)).toThrow(DslParseError);
  });
});

describe("FaultEvaluator runtime (§3.7)", () => {
  const rules = compileRules(
    [
      { id: "lean", when: "trunk_incline > 45", sustainMs: 300, severity: 15, msg: "fault.lean", cueCooldownMs: 4000 },
      { id: "shallow", when: "knee_avg_min > 130", perRep: true, severity: 25, msg: "fault.shallow" },
    ],
    SIGNALS,
  );

  it("sustainMs: a 2-frame lean spike never fires; a 300ms lean does", () => {
    const ev = new FaultEvaluator(rules);
    const lean = ctx({ trunk_incline: 50 });
    expect(ev.evaluateFrame(0, "side", "descent", lean).corrections).toHaveLength(0);
    expect(ev.evaluateFrame(100, "side", "descent", lean).corrections).toHaveLength(0);
    expect(ev.evaluateFrame(320, "side", "descent", lean).corrections).toHaveLength(1);
  });

  it("voice cue throttled by cueCooldownMs; corrections keep showing", () => {
    const ev = new FaultEvaluator(rules);
    const lean = ctx({ trunk_incline: 50 });
    ev.evaluateFrame(0, "side", "descent", lean);
    const first = ev.evaluateFrame(400, "side", "descent", lean);
    expect(first.voiceCue).toBe("fault.lean");
    const second = ev.evaluateFrame(800, "side", "descent", lean);
    expect(second.voiceCue).toBeNull(); // within 4000ms cooldown
    expect(second.corrections).toHaveLength(1);
  });

  it("phase-scope exit clears the sustain clock (no instant re-fire on re-entry)", () => {
    const phased = compileRules(
      [{ id: "lean", when: "trunk_incline > 45", phase: ["descent"], sustainMs: 300, severity: 15, msg: "fault.lean" }],
      SIGNALS,
    );
    const ev = new FaultEvaluator(phased);
    const lean = ctx({ trunk_incline: 50 });
    ev.evaluateFrame(0, "side", "descent", lean); // sustain starts
    ev.evaluateFrame(100, "side", "top", lean); // leaves the scoped phase
    // re-enter the phase 5s later: sustain must restart, not fire instantly
    expect(ev.evaluateFrame(5000, "side", "descent", lean).corrections).toHaveLength(0);
    expect(ev.evaluateFrame(5100, "side", "descent", lean).corrections).toHaveLength(0);
    expect(ev.evaluateFrame(5320, "side", "descent", lean).corrections).toHaveLength(1);
  });

  it("frame-scoped severe latches and marks the rep at completion (§3.7)", () => {
    const withSevere = compileRules(
      [{ id: "lean", when: "trunk_incline > 45", severe: "trunk_incline > 60", severity: 15, msg: "fault.lean" }],
      SIGNALS,
    );
    const ev = new FaultEvaluator(withSevere);
    ev.evaluateFrame(0, "side", "descent", ctx({ trunk_incline: 65 })); // severe lean mid-cycle
    ev.evaluateFrame(100, "side", "ascent", ctx({ trunk_incline: 10 })); // recovered
    const rep = ev.evaluateRep("side", ctx({}));
    expect(rep.severe).toBe(true); // the rep is still marked incorrect
    const rep2 = ev.evaluateRep("side", ctx({})); // latch cleared for next rep
    expect(rep2.severe).toBe(false);
  });

  it("rep-scoped rule fires once at completion; faultCounts accumulate", () => {
    const ev = new FaultEvaluator(rules);
    const rep = ev.evaluateRep("side", ctx({}, { knee_avg_min: 140 }));
    expect(rep.faults).toContain("shallow");
    ev.evaluateRep("side", ctx({}, { knee_avg_min: 150 }));
    expect(ev.faultCounts["shallow"]).toBe(2);
  });
});

describe("scoring (§3.8 — numerically identical curves)", () => {
  const depth = { component: "depth", input: "knee_avg_min", curve: [[100, 100], [130, 30], [155, 0]] as [number, number][], inactiveAbove: 155 };
  it("depth curve matches _score_depth anchor points and interpolates", () => {
    expect(evaluateCurve(depth.curve, 100)).toBe(100);
    expect(evaluateCurve(depth.curve, 130)).toBe(30);
    expect(evaluateCurve(depth.curve, 115)).toBeCloseTo(65, 6); // midpoint
    expect(evaluateCurve(depth.curve, 90)).toBe(100); // clamp deep
  });
  it("neutral 80 when no components active (standing between reps)", () => {
    const r = scoreRep([depth], () => 160, false); // above inactiveAbove
    expect(r.score).toBe(NEUTRAL_SCORE);
    expect(r.formCorrect).toBe(true);
  });
  it("formCorrect = score ≥ 70 AND no severe fault (verbatim)", () => {
    expect(scoreRep([depth], () => 100, false).formCorrect).toBe(true);
    expect(scoreRep([depth], () => 100, true).formCorrect).toBe(false); // severe kills it
    expect(scoreRep([depth], () => 140, false).formCorrect).toBe(false); // 18 < 70
    expect(CORRECT_AT).toBe(70);
  });
  it("session Form Score is exposure-weighted by reps", () => {
    expect(sessionFormScore([
      { avgFormScore: 90, reps: 10 },
      { avgFormScore: 60, reps: 2 },
    ])).toBe(85); // (900+120)/12
    expect(sessionFormScore([{ avgFormScore: null, reps: 5 }])).toBeNull();
  });
});

describe("scoring view scope (§4, T3 P1.7 finding A)", () => {
  it("a front-scoped component has NO opinion in side view even when its input resolves", () => {
    const comps = [
      { component: "depth", input: "knee_avg_min", curve: [[100, 100], [155, 0]] as [number, number][] },
      { component: "valgus", input: "valgus_delta_L_min", view: "front" as const, curve: [[0.15, 100], [0.3, 0]] as [number, number][], absolute: true },
    ];
    const inputs = (name: string) => (name === "knee_avg_min" ? 100 : -0.5); // valgus WOULD score 0
    const side = scoreRep(comps, inputs, false, 0, "side");
    expect(side.score).toBe(100); // depth only — valgus gated out by view
    const front = scoreRep(comps, inputs, false, 0, "front");
    expect(front.score).toBe(50); // both active: (100 + 0) / 2
  });
});
