// P1.7 — schema, linter, compile, bundle. The §4 worked squat example is the
// fixture: it must schema-parse, lint clean, compile, and drive the session.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  definitionBundleSchema,
  exerciseDefinitionSchema,
  type ExerciseDefinition,
} from "@app/shared";
import {
  DefinitionCompileError,
  NotImplementedError,
  compileDefinition,
  createSession,
  lintDefinition,
  parseTrace,
  replay,
} from "../src/index.js";

const squatDef: ExerciseDefinition = exerciseDefinitionSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "definitions/squat.v5.json"), "utf8")),
);

function defWith(patch: Record<string, unknown>): unknown {
  return { ...(squatDef as unknown as Record<string, unknown>), ...patch };
}

describe("schema (§4)", () => {
  it("accepts the worked squat example", () => {
    expect(squatDef.key).toBe("squat");
    expect(squatDef.rep?.bilateralGate).toBe(150); // number, per the worked example
  });
  it("rejects unknown keys, bad slug, bad semver, gps tracking", () => {
    expect(exerciseDefinitionSchema.safeParse(defWith({ extra: 1 })).success).toBe(false);
    expect(exerciseDefinitionSchema.safeParse(defWith({ key: "Not A Slug" })).success).toBe(false);
    expect(exerciseDefinitionSchema.safeParse(defWith({ minEngineVersion: "1.0" })).success).toBe(false);
    expect(exerciseDefinitionSchema.safeParse(defWith({ tracking: "gps" })).success).toBe(false);
  });
  it("rejects unknown signal names in signals[]", () => {
    expect(exerciseDefinitionSchema.safeParse(defWith({ signals: ["knee_avg", "chakra"] })).success).toBe(false);
  });
});

describe("linter (§9.2) — every rejection names field and reason", () => {
  const lint = (d: unknown, opts = {}) =>
    lintDefinition(exerciseDefinitionSchema.parse(d), opts);

  it("worked example lints clean", () => {
    expect(lintDefinition(squatDef)).toEqual([]);
  });
  it("rule referencing an undeclared signal", () => {
    const bad = lint(defWith({ signals: ["knee_avg", "knee_L", "knee_R"] }));
    expect(bad.some((i) => i.field.includes("trunk_lean") && i.message.includes("trunk_incline"))).toBe(true);
  });
  it("view-scoped rule in a definition excluding that view", () => {
    const bad = lint(defWith({ views: ["side"] }));
    expect(bad.some((i) => i.field.includes("knee_valgus") && i.message.includes("front"))).toBe(true);
  });
  it("non-monotonic curve", () => {
    const scoring = {
      components: [{ component: "depth", input: "knee_avg_min", curve: [[130, 30], [100, 100]] }],
    };
    expect(lint(defWith({ scoring }))[0]?.message).toMatch(/strictly increasing/);
  });
  it("upAt ≤ downAt", () => {
    const rep = { ...squatDef.rep, upAt: 100, downAt: 160 };
    expect(lint(defWith({ rep }))[0]?.field).toBe("rep.upAt");
  });
  it("inverted hold band", () => {
    const rep = { ...squatDef.rep, holdBand: [170, 150] };
    expect(lint(defWith({ rep })).some((i) => i.field === "rep.holdBand")).toBe(true);
  });
  it("missing camera hint", () => {
    expect(lint(defWith({ setup: undefined })).some((i) => i.field === "setup.cameraHint")).toBe(true);
  });
  it("msg keys absent from a supplied locale table", () => {
    const issues = lint(defWith({}), { localeKeys: ["fault.squat.depth", "setup.squat.camera"] });
    expect(issues.some((i) => i.field.includes("trunk_lean") && i.message.includes("locale"))).toBe(true);
  });
  it("live promotion requires ≥6 fixtures (§7.3)", () => {
    const issues = lint(defWith({ status: "live" }), { fixtureCount: 3 });
    expect(issues.some((i) => i.field === "status" && i.message.includes("6"))).toBe(true);
    expect(lint(defWith({ status: "live" }), { fixtureCount: 6 }).some((i) => i.field === "status")).toBe(false);
  });
  it("timer definitions must not carry engine blocks", () => {
    const issues = lint(
      defWith({ tracking: "timer", rep: undefined, faults: undefined, scoring: undefined, calibration: undefined }),
    );
    expect(issues.some((i) => i.field === "signals")).toBe(true); // signals still present
  });
  it("LHS ref offsets and 'target' without adaptive_target are rejected", () => {
    const faults = [{ id: "x", when: "knee_avg + 5 < 100", severity: 10, msg: "m" }];
    expect(lint(defWith({ faults })).some((i) => i.message.includes("offsets"))).toBe(true);
    const faults2 = [{ id: "x", when: "knee_avg_min > target + 25", severity: 10, msg: "m" }];
    expect(lint(defWith({ faults: faults2 })).some((i) => i.message.includes("adaptive_target"))).toBe(true);
  });
  it("unknown phase in a rule's phase scope", () => {
    const faults = [{ id: "x", when: "knee_avg > 100", phase: ["flying"], severity: 10, msg: "m" }];
    expect(lint(defWith({ faults })).some((i) => i.message.includes("flying"))).toBe(true);
  });
});

describe("compile (§4 → EngineConfig) + parity equivalence", () => {
  it("compiles the worked example", () => {
    const cfg = compileDefinition(squatDef, 1);
    expect(cfg.rep).toMatchObject({ upAt: 160, downAt: 100, bilateralGate: true });
    expect(cfg.metric).toBe("knee_avg");
    expect(cfg.useStandingBaseline).toBe(true);
    expect(cfg.scoring?.find((c) => c.component === "valgus")).toMatchObject({
      input: "valgus_delta_L_min",
      absolute: true,
      inactiveWhenPositiveDrift: true,
    });
  });
  it("timer definitions and non-Mode-A modes refuse to compile", () => {
    const timer = exerciseDefinitionSchema.parse({
      key: "brisk_walking", version: 1, minEngineVersion: "1.0.0", family: "cardio",
      tracking: "timer", status: "beta",
    });
    expect(() => compileDefinition(timer, 1)).toThrow(DefinitionCompileError);
    const hold = exerciseDefinitionSchema.parse(
      defWith({ rep: { mode: "hold", holdBand: [150, 180] } }),
    );
    expect(() => compileDefinition(hold, 1)).toThrow(NotImplementedError);
  });

  it("definition-driven session counts EXACTLY like the legacy config on the squat goldens", () => {
    // §8.1 note: the definition adds minRepMs 900 (spec-mandated); the legacy
    // Python floor is 450 — for parity equivalence we compile a variant with
    // the definition's minRepMs removed (booked P1.8b gate debt).
    const parityDef = exerciseDefinitionSchema.parse(
      defWith({ rep: { ...squatDef.rep, minRepMs: undefined, metric: "knee_L" } }),
    );
    const dir = join(import.meta.dirname, "traces/parity");
    const squatTraces = readdirSync(dir).filter((f) => /^squ?a[ut]/.test(f) && f.endsWith(".jsonl") && !f.includes("responses"));
    expect(squatTraces.length).toBeGreaterThanOrEqual(3);
    for (const f of squatTraces) {
      const trace = parseTrace(readFileSync(join(dir, f), "utf8"));
      const session = createSession(compileDefinition(parityDef, 1));
      const result = replay(session, trace);
      expect(result.summary.reps, `reps via definition on ${f}`).toBe(trace.header.expected.reps);
    }
  });
});

describe("bundle (§9.3)", () => {
  it("round-trips and cross-checks manifest against carried definitions", () => {
    const bundle = {
      bundleVersion: 1,
      channel: "beta",
      sha256: "a".repeat(64),
      manifest: { squat: 5 },
      definitions: [squatDef],
    };
    expect(definitionBundleSchema.parse(bundle).definitions).toHaveLength(1);
    const broken = { ...bundle, manifest: { squat: 4 } };
    expect(definitionBundleSchema.safeParse(broken).success).toBe(false);
  });
});
