// Part 2 §3.8 — two-layer scoring, reproducing the legacy squat scorer.
// Layer 1: piecewise-linear band curves per component (declarative
// _score_depth/_score_trunk_lean/_score_valgus). Layer 2: per-rep = mean of
// active components, 80 neutral when none active, formCorrect = ≥70 and no
// severe fault. Set avg = mean of rep scores. Isometric hold scoring: P1.6b.

export const NEUTRAL_SCORE = 80; // §3.8 / §8.1 "neutral score 80"
export const CORRECT_AT = 70; // §3.8 / §8.1 "correct bar ≥70"

export interface ScoringComponent {
  component: string;
  /** Signal or rep-aggregate name, e.g. "knee_avg_min". */
  input: string;
  /** Piecewise-linear [x, y] points, ascending x. */
  curve: [number, number][];
  /** Input above this ⇒ component inactive (no opinion). */
  inactiveAbove?: number;
  /** Input below this ⇒ inactive (e.g. outward valgus drift). */
  inactiveBelow?: number;
  /** Evaluate |input| through the curve (valgus magnitude). */
  absolute?: boolean;
}

/** Evaluate one curve at x. Clamps outside the point range to the end values. */
export function evaluateCurve(curve: readonly [number, number][], x: number): number {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (!first || !last) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (!a || !b) continue;
    if (x <= b[0]) {
      const span = b[0] - a[0];
      if (span === 0) return b[1];
      const frac = (x - a[0]) / span;
      return a[1] + frac * (b[1] - a[1]);
    }
  }
  return last[1];
}

export function componentScore(comp: ScoringComponent, rawInput: number | null): number | null {
  if (rawInput === null) return null; // no data → no opinion (I6)
  const x = comp.absolute === true ? Math.abs(rawInput) : rawInput;
  if (comp.inactiveAbove !== undefined && x > comp.inactiveAbove) return null;
  if (comp.inactiveBelow !== undefined && x < comp.inactiveBelow) return null;
  return evaluateCurve(comp.curve, x);
}

export interface RepScore {
  score: number; // 0–100 int
  formCorrect: boolean;
}

export function scoreRep(
  components: readonly ScoringComponent[],
  inputValue: (input: string) => number | null,
  hasSevereFault: boolean,
  floor = 0,
): RepScore {
  const active: number[] = [];
  for (const comp of components) {
    const s = componentScore(comp, inputValue(comp.input));
    if (s !== null) active.push(s);
  }
  const mean =
    active.length > 0 ? active.reduce((a, b) => a + b, 0) / active.length : NEUTRAL_SCORE;
  const score = Math.round(Math.max(floor, Math.min(100, mean)));
  return {
    score,
    formCorrect: score >= CORRECT_AT && !hasSevereFault, // §3.8 verbatim
  };
}

/** Session Form Score™: exposure-weighted mean across sets (§3.8) — weight =
 *  rep count (rep sets) so a 12-rep set counts 3× a 4-rep set. */
export function sessionFormScore(
  sets: readonly { avgFormScore: number | null; reps: number }[],
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const s of sets) {
    if (s.avgFormScore === null || s.reps === 0) continue;
    weighted += s.avgFormScore * s.reps;
    weight += s.reps;
  }
  return weight > 0 ? Math.round(weighted / weight) : null;
}
