// The pure half of `measure-scan-cost.ts` (ROADMAP 7a-iii-b): what its command
// line asks for, the scanner's key read out of an env file, and a run's cost
// against Kd's gate — on their own, so they are tested without a paid call.
import { isAbsolute, relative, resolve } from "node:path";
import { MEAL_VISION_MODELS, type MealVisionModel } from "../src/modules/nutrition/vision.adapter.js";
import { argValue } from "./import-usda-args.js";

/** Kd's gate (RULINGS 2026-09-16): an average above $0.00086 a scan stops the
 *  card, and the number goes to him before anything merges. */
export const SCAN_COST_GATE_MICRO_USD = 860;

/** The most photos one run sends. Every photo is a paid call, and Kd counts them
 *  (RULINGS 2026-09-15: one test call, never a sweep); 7a-iii-b's whole budget
 *  is ten. */
export const MAX_PHOTOS_PER_RUN = 10;

/** The photos the scanner takes, by the file's extension. */
export const PHOTO_TYPES: ReadonlyMap<string, string> = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"],
]);

export interface ScanCostArgs {
  /** The env file holding GEMINI_API_KEY. Only that line is read. */
  envFile: string;
  /** Where each reply and the run's results are written; never inside the repository. */
  outDir: string;
  /** Photo files, or folders of them. */
  paths: string[];
}

/** What the command line asks for, or what is wrong with it. `repoRoot` is the
 *  repository's own folder: the repository is public, so nothing a run writes —
 *  a reply read off a person's plate, the results — may land inside it. */
export function scanCostArgs(argv: readonly string[], repoRoot: string): ScanCostArgs | { problem: string } {
  const envFile = argValue(argv, "env");
  const outDir = argValue(argv, "out");
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (envFile === undefined || envFile === "") return { problem: "--env=<file> is needed: the file holding GEMINI_API_KEY" };
  if (outDir === undefined || outDir === "") return { problem: "--out=<folder> is needed: where each reply and the results are written" };
  if (paths.length === 0) return { problem: "name at least one photo, or a folder of them" };
  // Relative to the repository: "" or a path that does not climb out is inside
  // it; another drive comes back absolute, which is outside.
  const fromRoot = relative(resolve(repoRoot), resolve(outDir));
  if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) {
    return { problem: "--out is inside the repository, which is public: pick a folder outside it" };
  }
  return { envFile, outDir, paths };
}

/** The GEMINI_API_KEY line's value, unquoted, or null. Nothing else in the file is
 *  read, and the value is never part of an error — on this machine the same file
 *  holds the address of the real database. */
export function geminiKeyFrom(envText: string): string | null {
  for (const line of envText.split(/\r?\n/)) {
    const found = /^\s*(?:export\s+)?GEMINI_API_KEY\s*=(.*)$/.exec(line);
    if (found === null) continue;
    const value = (found[1] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    return value === "" ? null : value;
  }
  return null;
}

/** One call of a run: the tokens the provider billed, where it answered. */
export interface ScanCall {
  photo: string;
  /** Null where the provider sent no answer (the network, an HTTP error): nothing was billed. */
  usage: { tokensIn: number; tokensOut: number } | null;
}

export interface ScanCostSummary {
  calls: number;
  /** The calls the model answered, readable or not: each was a paid scan. */
  billed: number;
  /** Micro-USD a scan on average, exact (not a sum of rounded calls), or null with none billed. */
  averageMicroUsd: number | null;
  /** Whether that average is past Kd's gate. */
  overGate: boolean;
}

/** A run's average cost a scan at the model's list price, against the gate. */
export function summarizeScanCost(calls: readonly ScanCall[], model: MealVisionModel): ScanCostSummary {
  const billed = calls.flatMap((c) => (c.usage === null ? [] : [c.usage]));
  if (billed.length === 0) return { calls: calls.length, billed: 0, averageMicroUsd: null, overGate: false };
  const price = MEAL_VISION_MODELS[model];
  const total = billed.reduce(
    (sum, u) => sum + BigInt(u.tokensIn) * price.inputMicroUsdPerMillion + BigInt(u.tokensOut) * price.outputMicroUsdPerMillion,
    0n,
  );
  // Micro-USD × 1,000,000 over the scans: one division, so no rounding before the gate.
  const averageMicroUsd = Number(total) / 1_000_000 / billed.length;
  return { calls: calls.length, billed: billed.length, averageMicroUsd, overGate: averageMicroUsd > SCAN_COST_GATE_MICRO_USD };
}
