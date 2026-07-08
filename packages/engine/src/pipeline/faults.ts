// Part 2 §3.7 — the fault-rule DSL. A fault rule is data; the grammar is
// deliberately tiny: comparisons (< <= > >= ==) between a signal ref and a
// number, && || and parentheses, per-rep aggregates _min/_max/_avg, and the
// calibration ref `target` (C2). Parsed ONCE at definition load into an
// expression tree — zero per-frame parsing (I5).
import type { SignalName } from "./signals.js";

export interface FaultRule {
  id: string;
  view?: "front" | "side";
  phase?: string[];
  when: string;
  sustainMs?: number; // default 0 = instant
  perRep?: boolean;
  severity: number;
  severe?: string;
  msg: string;
  cueCooldownMs?: number;
}

// ── Expression tree ─────────────────────────────────────────────────────────
export type Aggregate = "min" | "max" | "avg";
export type CmpOp = "<" | "<=" | ">" | ">=" | "==";
/** RHS is a number literal or a ref (`target + N` — the grammar's only ref RHS). */
export type Expr =
  | { kind: "cmp"; op: CmpOp; ref: SignalRef; rhs: number | SignalRef }
  | { kind: "and"; left: Expr; right: Expr }
  | { kind: "or"; left: Expr; right: Expr };

const CMP_OPS: readonly CmpOp[] = ["<", "<=", ">", ">=", "=="];

function isCmpOp(v: string): v is CmpOp {
  return (CMP_OPS as readonly string[]).includes(v);
}

export interface SignalRef {
  signal: string; // base signal name, or "target" (C2)
  aggregate: Aggregate | null; // non-null ⇒ rep-scoped
  /** value = signal/aggregate, optionally + offset from `target + N` form */
  offset: number;
}

export class DslParseError extends Error {
  constructor(message: string, readonly expression: string) {
    super(`${message} in "${expression}"`);
    this.name = "DslParseError";
  }
}

// ── Parser (recursive descent over a token stream) ─────────────────────────
type Token =
  | { t: "ref"; name: string }
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "lparen" }
  | { t: "rparen" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s*(&&|\|\||<=|>=|==|<|>|\(|\)|\+|-?\d+(?:\.\d+)?|[a-zA-Z_][a-zA-Z0-9_]*)/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || m[1] === undefined) {
      if (src.slice(pos).trim() === "") break;
      throw new DslParseError(`unexpected character at ${String(pos)}`, src);
    }
    const tok = m[1];
    pos = re.lastIndex;
    if (tok === "(") tokens.push({ t: "lparen" });
    else if (tok === ")") tokens.push({ t: "rparen" });
    else if (["&&", "||", "<", "<=", ">", ">=", "==", "+"].includes(tok)) {
      tokens.push({ t: "op", v: tok });
    } else if (/^-?\d/.test(tok)) tokens.push({ t: "num", v: Number(tok) });
    else tokens.push({ t: "ref", name: tok });
  }
  return tokens;
}

export function parseCondition(src: string, knownSignals: readonly string[]): Expr {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function parseRef(): SignalRef {
    const tok = next();
    if (tok?.t !== "ref") throw new DslParseError("expected signal reference", src);
    let name = tok.name;
    let aggregate: Aggregate | null = null;
    const m = /^(.*)_(min|max|avg)$/.exec(name);
    if (m?.[1] !== undefined && m[2] !== undefined && name !== "target") {
      // aggregate suffix only when the base is a known signal (valgus_delta_min
      // → base valgus_delta_L/R handled by definitions; here base must be known)
      if (knownSignals.includes(m[1])) {
        name = m[1];
        aggregate = m[2] as Aggregate;
      }
    }
    if (name !== "target" && !knownSignals.includes(name)) {
      throw new DslParseError(`unknown signal "${name}"`, src);
    }
    let offset = 0;
    if (peek()?.t === "op" && (peek() as { v?: string }).v === "+") {
      next();
      const num = next();
      if (num?.t !== "num") throw new DslParseError("expected number after +", src);
      offset = num.v;
    }
    return { signal: name, aggregate, offset };
  }

  function parseComparison(): Expr {
    if (peek()?.t === "lparen") {
      next();
      const inner = parseOr();
      const close = next();
      if (close?.t !== "rparen") throw new DslParseError("expected )", src);
      return inner;
    }
    const ref = parseRef();
    const op = next();
    if (op?.t !== "op" || !isCmpOp(op.v)) {
      throw new DslParseError("expected comparison operator", src);
    }
    const rhsTok = next();
    if (rhsTok?.t === "num") {
      return { kind: "cmp", op: op.v, ref, rhs: rhsTok.v };
    }
    if (rhsTok?.t === "ref") {
      // `signal > target + 25` form: RHS is a ref with optional offset.
      i--; // put back
      return { kind: "cmp", op: op.v, ref, rhs: parseRef() };
    }
    throw new DslParseError("expected number or ref after comparison", src);
  }

  function parseOr(): Expr {
    let left = parseAnd();
    while (peek()?.t === "op" && (peek() as { v?: string }).v === "||") {
      next();
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  }
  function parseAnd(): Expr {
    let left = parseComparison();
    while (peek()?.t === "op" && (peek() as { v?: string }).v === "&&") {
      next();
      left = { kind: "and", left, right: parseComparison() };
    }
    return left;
  }

  const expr = parseOr();
  if (i !== tokens.length) throw new DslParseError("trailing tokens", src);
  return expr;
}

// ── Evaluation ──────────────────────────────────────────────────────────────
export interface EvalContext {
  /** Current-frame smoothed signal values. */
  frame: (name: string) => number | null;
  /** Rep-scoped aggregate over the completed cycle. */
  aggregate: (name: string, agg: Aggregate) => number | null;
  /** C2 target (null when no adaptive target configured). */
  target: () => number | null;
}

function refValue(ref: SignalRef, ctx: EvalContext): number | null {
  let v: number | null;
  if (ref.signal === "target") v = ctx.target();
  else if (ref.aggregate !== null) v = ctx.aggregate(ref.signal, ref.aggregate);
  else v = ctx.frame(ref.signal);
  return v === null ? null : v + ref.offset;
}

/** null anywhere ⇒ null result (no decision on missing data, I6). */
export function evaluate(expr: Expr, ctx: EvalContext): boolean | null {
  switch (expr.kind) {
    case "cmp": {
      const lhs = refValue(expr.ref, ctx);
      const rhs = typeof expr.rhs === "number" ? expr.rhs : refValue(expr.rhs, ctx);
      if (lhs === null || rhs === null) return null;
      return cmpNum(expr.op, lhs, rhs);
    }
    case "and": {
      const l = evaluate(expr.left, ctx);
      const r = evaluate(expr.right, ctx);
      if (l === false || r === false) return false;
      if (l === null || r === null) return null;
      return true;
    }
    case "or": {
      const l = evaluate(expr.left, ctx);
      const r = evaluate(expr.right, ctx);
      if (l === true || r === true) return true;
      if (l === null || r === null) return null;
      return false;
    }
  }
}

function cmpNum(op: "<" | "<=" | ">" | ">=" | "==", a: number, b: number): boolean {
  switch (op) {
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "==": return a === b;
  }
}

// ── Runtime rule engine ─────────────────────────────────────────────────────
export interface CompiledRule {
  rule: FaultRule;
  when: Expr;
  severe: Expr | null;
}

export function compileRules(rules: readonly FaultRule[], knownSignals: readonly string[]): CompiledRule[] {
  return rules.map((rule) => ({
    rule,
    when: parseCondition(rule.when, knownSignals),
    severe: rule.severe !== undefined ? parseCondition(rule.severe, knownSignals) : null,
  }));
}

export interface FiredFault {
  id: string;
  severity: number;
  severe: boolean;
  msg: string;
}

/** Per-set fault evaluator: frame-scoped rules with sustainMs, rep-scoped
 *  rules at completion, §3.7 coaching policy (2 corrections, worst voice). */
export class FaultEvaluator {
  private readonly sustainedSince = new Map<string, number>();
  private readonly firedThisRep = new Set<string>();
  private readonly lastCueT = new Map<string, number>();
  private severeThisRep = false; // frame-scoped severes latch until rep completion (§3.7)
  readonly faultCounts: Record<string, number> = {};

  constructor(private readonly rules: readonly CompiledRule[]) {}

  private isRepScoped(c: CompiledRule): boolean {
    return c.rule.perRep === true || exprUsesAggregate(c.when);
  }

  /** Frame-scoped evaluation. Returns corrections (≤2) + voice cue (or null). */
  evaluateFrame(
    t: number,
    view: string,
    phase: string,
    ctx: EvalContext,
  ): { corrections: FiredFault[]; voiceCue: string | null } {
    const fired: FiredFault[] = [];
    for (const c of this.rules) {
      if (this.isRepScoped(c)) continue;
      if (
        (c.rule.view !== undefined && c.rule.view !== view) ||
        (c.rule.phase !== undefined && !c.rule.phase.includes(phase))
      ) {
        // Out of scope: the condition is NOT persisting — a stale timestamp
        // here would make sustainMs fire instantly on scope re-entry (§3.7).
        this.sustainedSince.delete(c.rule.id);
        continue;
      }
      const hit = evaluate(c.when, ctx);
      if (hit !== true) {
        this.sustainedSince.delete(c.rule.id);
        continue;
      }
      const since = this.sustainedSince.get(c.rule.id) ?? t;
      this.sustainedSince.set(c.rule.id, since);
      if (t - since < (c.rule.sustainMs ?? 0)) continue;
      const severe = c.severe !== null && evaluate(c.severe, ctx) === true;
      if (severe) this.severeThisRep = true; // marks the rep incorrect at completion
      fired.push({ id: c.rule.id, severity: c.rule.severity, severe, msg: c.rule.msg });
      if (!this.firedThisRep.has(c.rule.id)) {
        this.firedThisRep.add(c.rule.id);
        this.faultCounts[c.rule.id] = (this.faultCounts[c.rule.id] ?? 0) + 1;
      }
    }
    // Coaching policy (§3.7): ≤2 corrections, severity-ordered, deduped;
    // voice = single worst, throttled per rule by cueCooldownMs.
    fired.sort((a, b) => b.severity - a.severity);
    const corrections = fired.slice(0, 2);
    let voiceCue: string | null = null;
    const worst = corrections[0];
    if (worst) {
      const rule = this.rules.find((r) => r.rule.id === worst.id)?.rule;
      const cooldown = rule?.cueCooldownMs ?? 0;
      const last = this.lastCueT.get(worst.id);
      if (last === undefined || t - last >= cooldown) {
        this.lastCueT.set(worst.id, t);
        voiceCue = worst.msg;
      }
    }
    return { corrections, voiceCue };
  }

  /** Rep-scoped evaluation at completion. Returns this rep's fault ids + severe flag. */
  evaluateRep(view: string, ctx: EvalContext): { faults: string[]; severe: boolean } {
    const faults: string[] = [...this.firedThisRep];
    let severe = this.severeThisRep; // frame-scoped severes latched during the cycle
    for (const c of this.rules) {
      if (!this.isRepScoped(c)) continue;
      if (c.rule.view !== undefined && c.rule.view !== view) continue;
      if (evaluate(c.when, ctx) === true) {
        if (!faults.includes(c.rule.id)) faults.push(c.rule.id);
        this.faultCounts[c.rule.id] = (this.faultCounts[c.rule.id] ?? 0) + 1;
      }
      if (c.severe !== null && evaluate(c.severe, ctx) === true) severe = true;
    }
    this.firedThisRep.clear();
    this.sustainedSince.clear();
    this.severeThisRep = false;
    return { faults, severe };
  }
}

export function exprUsesAggregate(expr: Expr): boolean {
  switch (expr.kind) {
    case "cmp": {
      const rhs = typeof expr.rhs === "number" ? null : expr.rhs;
      return (
        expr.ref.aggregate !== null ||
        expr.ref.signal === "target" ||
        (rhs !== null && (rhs.aggregate !== null || rhs.signal === "target"))
      );
    }
    case "and":
    case "or":
      return exprUsesAggregate(expr.left) || exprUsesAggregate(expr.right);
  }
}

export type { SignalName };
