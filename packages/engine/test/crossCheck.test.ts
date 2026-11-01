// The cross-check (Part 2 §11.2, tool 4) and the upright rule it asked for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExerciseDefinition } from "@app/shared";
import { ModeAFsm, compileDefinition, createSession, parseTrace, replay } from "../src/index.js";
import {
  crossCheckTrace,
  faultsIn,
  listTraceFiles,
  loadDefinitions,
  tableLines,
  verdictFor,
} from "../scripts/video/crossCheck.js";

const DEFS = join(import.meta.dirname, "../src/definitions");
const STORED = join(import.meta.dirname, "traces");
const OTHERS = join(import.meta.dirname, "cross-check-traces");
const definitions = loadDefinitions(DEFS);
const defOf = (key: string): ExerciseDefinition => {
  const d = definitions.find((x) => x.key === key);
  if (!d) throw new Error(key);
  return d;
};
const read = (f: string): string => readFileSync(f, "utf8");

/** Count with the definition's rep rules, the upright limit replaced by the one given. */
function count(definition: ExerciseDefinition, file: string, uprightUnder?: number): number {
  const config = compileDefinition(definition, 1);
  const rep = { ...config.rep };
  delete rep.uprightUnder;
  if (uprightUnder !== undefined) rep.uprightUnder = uprightUnder;
  return replay(createSession({ ...config, rep }), parseTrace(read(file))).summary.reps;
}

describe("the worst thing: a real squat stops counting", () => {
  const clips = listTraceFiles(STORED);
  it("reads every stored squat-family clip", () => {
    expect(clips).toHaveLength(10);
  });
  for (const file of clips) {
    it(`${file.split(/[\\/]/).pop() ?? file}: the same count with and without the upright rule, under all three rules`, () => {
      for (const d of definitions) {
        expect(d.rep?.uprightUnder).toBe(45);
        const without = count(d, file);
        expect(count(d, file, d.rep?.uprightUnder)).toBe(without);
        // Measured: the fast jump clip under chair squat's rules needs 27, the most of any.
        expect(count(d, file, 28)).toBe(without);
      }
    });
  }
});

describe("rules on another exercise's video", () => {
  const CASES: [video: string, without: Record<string, number>][] = [
    ["bicycle_crunch_reference", { squat: 1, chair_squat: 3, jump_squat: 6 }],
    ["bicep_curl_reference", { squat: 0, chair_squat: 0, jump_squat: 0 }],
    ["barbell_bench_press_reference", { squat: 0, chair_squat: 0, jump_squat: 0 }],
    ["dumbbell_bench_press_8s", { squat: 0, chair_squat: 0, jump_squat: 0 }],
  ];
  for (const [video, without] of CASES) {
    it(`${video} counts nothing; without the upright rule: ${JSON.stringify(without)}`, () => {
      const file = join(OTHERS, `${video}.jsonl`);
      for (const d of definitions) {
        expect(count(d, file)).toBe(without[d.key]);
        expect(replay(createSession(compileDefinition(d, 1)), parseTrace(read(file))).summary.reps).toBe(0);
        // Measured: the crunch stays at 0 up to 71, under jump squat's rules the first to break.
        expect(count(d, file, 70)).toBe(0);
      }
    });
  }

  it("the whole table holds no fault", () => {
    const rows = [...listTraceFiles(STORED), ...listTraceFiles(OTHERS)].map((f) =>
      crossCheckTrace(f, read(f), definitions),
    );
    expect(rows).toHaveLength(14);
    expect(tableLines(rows, definitions).at(-1)).toContain("No faults");
    expect(faultsIn(rows)).toBe(0);
    for (const row of rows) {
      for (const cell of row.cells) expect(cell.verdict).not.toBe("cannot run");
    }
  });
});

describe("how a count is judged", () => {
  const squat = defOf("squat");
  const CASES: [string, string, string | null, number, string][] = [
    ["its own video", "squat", "squat_pattern", 2, "own"],
    ["its own video, nothing counted", "squat", "squat_pattern", 0, "own"],
    ["a twin counts", "chair_squat", "squat_pattern", 3, "twin"],
    ["a twin counts nothing", "jump_squat", "squat_pattern", 0, "none"],
    ["another family counts", "lunge", "lunge_pattern", 1, "fault"],
    ["an exercise with no rules yet counts", "bicycle_crunch", null, 1, "fault"],
    ["an exercise with no rules yet counts nothing", "bicep_curl", null, 0, "none"],
  ];
  for (const [what, exercise, family, reps, verdict] of CASES) {
    it(what, () => {
      expect(verdictFor(squat, exercise, family, reps)).toBe(verdict);
    });
  }

  it("rules the engine cannot run yet are said so, not passed in silence", () => {
    const hold: ExerciseDefinition = { ...squat, key: "plank", rep: { mode: "hold" } };
    const file = join(OTHERS, "bicep_curl_reference.jsonl");
    const row = crossCheckTrace(file, read(file), [hold]);
    expect(row.cells[0]).toEqual({ rules: "plank", reps: null, verdict: "cannot run" });
    expect(tableLines([row], [hold])[1]).toContain("cannot run");
  });

  it("a fault fails the table and is named", () => {
    const rep = { mode: "alternating_threshold" as const, metric: "knee_L" as const, upAt: 160, downAt: 130, countOn: "up" as const };
    const loose: ExerciseDefinition = { ...squat, rep };
    const file = join(OTHERS, "bicycle_crunch_reference.jsonl");
    const rows = [crossCheckTrace(file, read(file), [loose])];
    expect(faultsIn(rows)).toBeGreaterThan(0);
    expect(tableLines(rows, [loose])[1]).toContain("FAULT");
    expect(tableLines(rows, [loose]).at(-1)).toContain("Faults:");
  });
});

describe("a rep finishes only upright", () => {
  const RULES = { mode: "alternating_threshold" as const, upAt: 160, downAt: 130, countOn: "up" as const, bilateralGate: false };
  const FRAME = 66.7;
  // Bend, then straighten the knees with the trunk at each angle in turn.
  function standAt(trunks: readonly (number | null)[], uprightUnder?: number): number {
    const fsm = new ModeAFsm({ ...RULES, ...(uprightUnder !== undefined ? { uprightUnder } : {}) });
    let t = 0;
    let reps = 0;
    const step = (knee: number, trunk: number | null): void => {
      reps = fsm.update(t, knee, null, trunk).repCount;
      t += FRAME;
    };
    for (let i = 0; i < 8; i++) step(175, 0);
    for (let i = 0; i < 10; i++) step(90, 30);
    for (let i = 0; i < 8; i++) step(175, 70); // the average rises past the line while leaning
    for (const trunk of trunks) step(175, trunk);
    return reps;
  }
  const CASES: [string, (number | null)[], number | undefined, number][] = [
    ["upright", [5, 5], 45, 1],
    ["just under the limit", [44.9, 44.9], 45, 1],
    ["at the limit", [45, 45], 45, 0],
    ["lying down", [75, 75], 45, 0],
    ["no reading of the trunk", [null, null], 45, 1],
    ["lying down with no rule asked", [75, 75], undefined, 1],
  ];
  for (const [what, trunks, limit, reps] of CASES) {
    it(`${what}: ${String(reps)}`, () => {
      expect(standAt(trunks, limit)).toBe(reps);
    });
  }

  it("the rep waits: leaning, then straightening, counts once", () => {
    expect(standAt([60, 60, 60, 10, 10, 10], 45)).toBe(1);
  });
  it("one upright frame while lying is not enough", () => {
    expect(standAt([80, 10, 80, 10, 80], 45)).toBe(0);
  });
});
