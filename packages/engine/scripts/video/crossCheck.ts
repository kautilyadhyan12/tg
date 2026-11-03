// Every exercise's rules on every other exercise's trace (Part 2 §11.2, tool 4).
// A count on another exercise's trace is a fault unless both are of one family.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { exerciseDefinitionSchema, type ExerciseDefinition } from "@app/shared";
import {
  DefinitionCompileError,
  NotImplementedError,
  UNCOUNTED_REPS,
  compileDefinition,
  createSession,
  parseTrace,
  replay,
  type Trace,
} from "../../src/index.js";

export type Verdict = "own" | "none" | "twin" | "fault" | "cannot run";

export interface Cell {
  rules: string;
  reps: number | null;
  verdict: Verdict;
}

export interface Row {
  file: string;
  exercise: string;
  personCount: number | null;
  cells: Cell[];
}

export function verdictFor(
  rules: ExerciseDefinition,
  traceExercise: string,
  familyOfTrace: string | null,
  reps: number,
): Verdict {
  if (rules.key === traceExercise) return "own";
  if (reps === 0) return "none";
  return rules.family === familyOfTrace ? "twin" : "fault";
}

export function loadDefinitions(folder: string): ExerciseDefinition[] {
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .map((f) => exerciseDefinitionSchema.parse(JSON.parse(readFileSync(join(folder, f), "utf8"))));
}

/** Every trace under a folder; a `.responses.jsonl` beside one is not a trace. */
export function listTraceFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".responses.jsonl"))
    .map((f) => join(folder, f))
    .sort();
}

function countWith(definition: ExerciseDefinition, trace: Trace): number | null {
  try {
    return replay(createSession(compileDefinition(definition, 1)), trace).summary.reps;
  } catch (err) {
    // Rules of a kind the engine has not built, or timed only: no count to judge.
    if (err instanceof NotImplementedError || err instanceof DefinitionCompileError) return null;
    throw err;
  }
}

export function crossCheckTrace(file: string, text: string, definitions: readonly ExerciseDefinition[]): Row {
  const trace = parseTrace(text);
  const exercise = trace.header.exercise;
  const family = definitions.find((d) => d.key === exercise)?.family ?? null;
  const stored = trace.header.expected.reps;
  return {
    file: basename(file, ".jsonl"),
    exercise,
    personCount: stored === UNCOUNTED_REPS ? null : stored,
    cells: definitions.map((d) => {
      const reps = countWith(d, trace);
      return {
        rules: d.key,
        reps,
        verdict: reps === null ? "cannot run" : verdictFor(d, exercise, family, reps),
      };
    }),
  };
}

export const faultsIn = (rows: readonly Row[]): number =>
  rows.reduce((n, r) => n + r.cells.filter((c) => c.verdict === "fault").length, 0);

function cellText(c: Cell, personCount: number | null): string {
  if (c.reps === null) return "cannot run";
  if (c.verdict === "own") return `${String(c.reps)} own (person ${personCount === null ? "?" : String(personCount)})`;
  if (c.verdict === "none") return "0";
  return `${String(c.reps)} ${c.verdict === "fault" ? "FAULT" : "twin"}`;
}

export function tableLines(rows: readonly Row[], definitions: readonly ExerciseDefinition[]): string[] {
  const head = ["video", "recorded as", ...definitions.map((d) => d.key)];
  const body = rows.map((r) => [r.file, r.exercise, ...r.cells.map((c) => cellText(c, r.personCount))]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? "").length)));
  const line = (cols: readonly string[]): string =>
    cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  const faults = faultsIn(rows);
  return [
    line(head),
    ...body.map(line),
    faults === 0
      ? "No faults: nothing counted on another exercise's video outside its own family."
      : `Faults: ${String(faults)}. Rules counted on another exercise's video. Fix the rules, or the family if it is wrong.`,
  ];
}
