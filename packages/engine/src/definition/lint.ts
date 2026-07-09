// Part 2 §9.2 — the definition linter. Every rejection names the field and
// the reason: authoring stays a one-person-friendly loop. Pure: the document
// arrives already schema-parsed (shared exerciseDefinitionSchema); this layer
// enforces the cross-field rules a schema can't express.
import type { ExerciseDefinition } from "@app/shared";
import { DslParseError, parseCondition, type Expr, type SignalRef } from "../pipeline/faults.js";

export interface LintIssue {
  field: string;
  message: string;
}

export interface LintOptions {
  /** Locale message keys; when supplied, msg/cameraHint keys must exist in it. */
  localeKeys?: readonly string[];
  /** Recorded fixture count for this exercise (drives the `live` gate, §7.3). */
  fixtureCount?: number;
}

const FIXTURES_REQUIRED_FOR_LIVE = 6; // §7.3: at least 6 traces before leaving beta

function collectRefs(expr: Expr, out: SignalRef[]): void {
  if (expr.kind === "cmp") {
    out.push(expr.ref);
    if (typeof expr.rhs !== "number") out.push(expr.rhs);
    return;
  }
  collectRefs(expr.left, out);
  collectRefs(expr.right, out);
}

/** Scoring inputs: `name`, `name_min|_max|_avg`, or `abs(...)` of those. */
function scoringInputBase(input: string): { base: string; aggregate: boolean } {
  const inner = /^abs\((.+)\)$/.exec(input)?.[1] ?? input;
  const m = /^(.*)_(min|max|avg)$/.exec(inner);
  if (m?.[1] !== undefined) return { base: m[1], aggregate: true };
  return { base: inner, aggregate: false };
}

export function lintDefinition(def: ExerciseDefinition, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (field: string, message: string): void => {
    issues.push({ field, message });
  };
  const declared: readonly string[] = def.signals ?? [];
  const views = def.views ?? [];
  const isTimer = def.tracking === "timer";

  // §4 v1.1: timer entries carry NO engine blocks — reject if present.
  if (isTimer) {
    for (const block of ["signals", "rep", "faults", "scoring"] as const) {
      if (def[block] !== undefined) {
        add(block, `tracking:"timer" definitions must not carry '${block}' (§4)`);
      }
    }
    return issues; // nothing else applies to timer entries (no camera ⇒ no hint required)
  }

  // Pose entries: required engine blocks.
  if (def.rep === undefined) add("rep", "pose definitions need a rep block");
  if (def.signals === undefined || def.signals.length === 0) {
    add("signals", "pose definitions must declare their signal list (§4)");
  }
  if (def.setup?.cameraHint === undefined) {
    add("setup.cameraHint", "missing camera hint (§9.2 — the #1 real-world failure mode)");
  }

  // Rep-block sanity (Mode A; other modes gain rules in P1.6b).
  const rep = def.rep;
  if (rep) {
    if (rep.mode === "alternating_threshold") {
      if (rep.metric === undefined) add("rep.metric", "Mode A requires a metric signal");
      else if (!declared.includes(rep.metric)) {
        add("rep.metric", `metric '${rep.metric}' is not in signals[]`);
      }
      if (rep.upAt === undefined || rep.downAt === undefined) {
        add("rep", "Mode A requires upAt and downAt");
      } else if (rep.upAt <= rep.downAt) {
        add("rep.upAt", `upAt (${String(rep.upAt)}) must be > downAt (${String(rep.downAt)}) (§9.2)`);
      }
    }
    if (rep.holdBand !== undefined && rep.holdBand[0] >= rep.holdBand[1]) {
      add("rep.holdBand", "hold band inverted (§9.2)");
    }
  }

  // View-scoped rules/components must not reference excluded views.
  const checkViewScope = (field: string, view: "front" | "side" | undefined): void => {
    if (view !== undefined && views.length > 0 && !views.includes(view)) {
      add(field, `scoped to view '${view}' but views=[${views.join(",")}] excludes it (§9.2)`);
    }
  };

  // Fault rules: DSL parse, signal refs, phases, msg keys, LHS offsets, severe base.
  const phases = def.phases ?? [];
  for (const [i, rule] of (def.faults ?? []).entries()) {
    const field = `faults[${String(i)}](${rule.id})`;
    checkViewScope(field + ".view", rule.view);
    for (const p of rule.phase ?? []) {
      if (phases.length > 0 && !phases.includes(p)) {
        add(field + ".phase", `unknown phase '${p}' (phases=[${phases.join(",")}])`);
      }
    }
    for (const [exprField, src] of [
      [field + ".when", rule.when],
      [field + ".severe", rule.severe],
    ] as const) {
      if (src === undefined) continue;
      try {
        const expr = parseCondition(src, declared);
        const refs: SignalRef[] = [];
        collectRefs(expr, refs);
        for (const ref of refs) {
          if (ref.signal !== "target" && ref.offset !== 0) {
            add(exprField, `ref offsets are only allowed on 'target' (+N); '${ref.signal} + ${String(ref.offset)}' is rejected (DECISIONS)`);
          }
          if (ref.signal !== "target" && !declared.includes(ref.signal)) {
            add(exprField, `references '${ref.signal}' which is not in signals[] (§9.2)`);
          }
          if (ref.signal === "target" && !def.calibration?.some((c) => c.module === "adaptive_target")) {
            add(exprField, "'target' requires an adaptive_target calibration module");
          }
        }
      } catch (e) {
        if (e instanceof DslParseError) add(exprField, e.message);
        else throw e;
      }
    }
    // §9.2's "severe without a base fault" is structurally unrepresentable
    // here: the schema requires a non-empty `when` on every rule, so a severe
    // expression always has a base condition. No runtime check needed.
    if (opts.localeKeys && !opts.localeKeys.includes(rule.msg)) {
      add(field + ".msg", `message key '${rule.msg}' absent from the locale table (§9.2)`);
    }
  }

  // Ambiguity guard (DECISIONS): a declared signal whose name is another
  // declared signal + aggregate suffix is genuinely ambiguous (knee_avg is
  // fine — "knee" is not a signal; a hypothetical "knee_avg_min" would not be).
  for (const s of declared) {
    const m = /^(.*)_(min|max|avg)$/.exec(s);
    if (m?.[1] !== undefined && declared.includes(m[1])) {
      add("signals", `signal name '${s}' collides with the aggregate suffix of '${m[1]}'`);
    }
  }

  // Scoring: curve monotonicity, input refs, view scope.
  for (const [i, comp] of (def.scoring?.components ?? []).entries()) {
    const field = `scoring.components[${String(i)}](${comp.component})`;
    checkViewScope(field + ".view", comp.view);
    for (let p = 1; p < comp.curve.length; p++) {
      const prev = comp.curve[p - 1];
      const cur = comp.curve[p];
      if (prev && cur && cur[0] <= prev[0]) {
        add(field + ".curve", `curve x values must be strictly increasing (§9.2): ${String(prev[0])} → ${String(cur[0])}`);
        break;
      }
    }
    const { base } = scoringInputBase(comp.input);
    if (base !== "target" && !declared.includes(base)) {
      add(field + ".input", `input '${comp.input}' references '${base}' which is not in signals[] (§9.2)`);
    }
  }

  // Locale check for setup hint.
  if (opts.localeKeys && def.setup?.cameraHint !== undefined && !opts.localeKeys.includes(def.setup.cameraHint)) {
    add("setup.cameraHint", `key '${def.setup.cameraHint}' absent from the locale table (§9.2)`);
  }

  // Live promotion gate: fixture matrix complete (§7.3 ≥6).
  if (def.status === "live" && opts.fixtureCount !== undefined && opts.fixtureCount < FIXTURES_REQUIRED_FOR_LIVE) {
    add("status", `live requires ≥${String(FIXTURES_REQUIRED_FOR_LIVE)} recorded fixtures (§7.3); have ${String(opts.fixtureCount)}`);
  }

  return issues;
}
