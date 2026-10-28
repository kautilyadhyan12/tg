// ROADMAP 7a-iii-b — the cost-measuring tool's pure half: what its command line
// asks for, the scanner's key out of an env file, and a run's average against
// Kd's gate. The run itself makes paid calls, so it is never part of a test.
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PHOTOS_PER_RUN, PHOTO_TYPES, SCAN_COST_GATE_MICRO_USD, SCAN_KEY_NAME, keyFrom, scanCostArgs, summarizeScanCost } from "../tools/scan-cost.js";

const REPO = resolve(import.meta.dirname, "../../..");
/** Folders outside the repository on any system: beside it, and the system's own temp folder. */
const PLATES = resolve(REPO, "../plates");
const OUT = resolve(REPO, "../plates/out");
/** What is wrong with a command line, or "" where nothing is. */
const problemOf = (argv: string[]): string => {
  const read = scanCostArgs(argv, REPO);
  return "problem" in read ? read.problem : "";
};

describe("the command line", () => {
  it("needs the env file, the output folder and at least one photo", () => {
    expect(scanCostArgs(["--env=.env", `--out=${OUT}`, PLATES], REPO)).toEqual({ envFile: ".env", outDir: OUT, paths: [PLATES] });
    expect(problemOf([`--out=${OUT}`, PLATES])).toContain("OPENAI_API_KEY");
    expect(problemOf([`--out=${OUT}`, PLATES])).toContain("--env");
    expect(problemOf(["--env=", `--out=${OUT}`, PLATES])).toContain("--env");
    expect(problemOf(["--env=.env", PLATES])).toContain("--out");
    expect(problemOf(["--env=.env", `--out=${OUT}`])).toContain("photo");
  });

  it("never writes inside the repository, which is public", () => {
    for (const inside of [REPO, resolve(REPO, "apps/api/test/fixtures"), resolve(REPO, "tmp/../plates-out")]) {
      expect(problemOf(["--env=.env", `--out=${inside}`, PLATES]), inside).toContain("inside the repository");
    }
    // Beside it, a folder whose name only starts like it, or the system's temp folder, is outside.
    for (const outside of [resolve(REPO, "../ai-home-gym-plates/out"), `${REPO}-2`, resolve(tmpdir(), "plates-out")]) {
      expect(scanCostArgs(["--env=.env", `--out=${outside}`, PLATES], REPO), outside).toMatchObject({ outDir: outside });
    }
    // On Windows another drive is outside too; relative() answers it with an absolute path.
    if (process.platform === "win32") expect(scanCostArgs(["--env=.env", "--out=Z:/plates/out", PLATES], REPO)).toMatchObject({ outDir: "Z:/plates/out" });
  });

  it("takes at most ten photos a run, of the kinds the scanner takes", () => {
    expect(MAX_PHOTOS_PER_RUN).toBe(10);
    expect([...PHOTO_TYPES]).toEqual([[".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"]]);
  });
});

describe("the scanner's key", () => {
  it("is the model's own key line's value, unquoted, and nothing else in the file", () => {
    expect(SCAN_KEY_NAME).toBe("OPENAI_API_KEY");
    const file = ["DATABASE_URL=postgres://someone:secret@example/db", "GROQ_API_KEY=groq-value", "GEMINI_API_KEY=gemini-value", "OPENAI_API_KEY=openai-value", ""].join("\r\n"); // gitleaks:allow
    expect(keyFrom(file, SCAN_KEY_NAME)).toBe("openai-value");
    expect(keyFrom('OPENAI_API_KEY="quoted value"\n', SCAN_KEY_NAME)).toBe("quoted value");
    expect(keyFrom("export OPENAI_API_KEY='single'\n", SCAN_KEY_NAME)).toBe("single");
    expect(keyFrom("  OPENAI_API_KEY = spaced \n", SCAN_KEY_NAME)).toBe("spaced");
  });

  it("is missing where the line is absent, empty, or another name", () => {
    expect(keyFrom("", SCAN_KEY_NAME)).toBeNull();
    expect(keyFrom("OPENAI_API_KEY=\n", SCAN_KEY_NAME)).toBeNull();
    expect(keyFrom('OPENAI_API_KEY=""\n', SCAN_KEY_NAME)).toBeNull();
    expect(keyFrom("OLD_OPENAI_API_KEY=value\n# OPENAI_API_KEY=commented\n", SCAN_KEY_NAME)).toBeNull();
    // Another provider's line is not the scanner's key.
    expect(keyFrom("GEMINI_API_KEY=gemini-value\n", SCAN_KEY_NAME)).toBeNull();
  });
});

describe("a run's cost", () => {
  it("is the exact average a billed scan, at the model's list price, against Kd's gate", () => {
    expect(SCAN_COST_GATE_MICRO_USD).toBe(860);
    // Kd's eight plates on GPT-6 Luna at high detail, 2026-10-28, as the tool measured
    // them: 7,600 in at $0.10 and 1,298 out at $0.50 per 1M, 176.125 micro-USD a scan.
    const plates = [[1029, 146], [914, 198], [914, 180], [914, 171], [1030, 105], [856, 126], [1029, 182], [914, 190]] as const;
    const run = summarizeScanCost(plates.map(([tokensIn, tokensOut], at) => ({ photo: String(at), usage: { tokensIn, tokensOut } })), "gpt-6-luna");
    expect(run).toEqual({ calls: 8, billed: 8, averageMicroUsd: 176.125, overGate: false });
  });

  it("counts only the calls the model answered, and is over the gate only past $0.00086", () => {
    // 2,000 in and 1,320 out on Luna is 200 + 660 = 860 micro-USD: at the gate, not over it.
    const atGate = summarizeScanCost([{ photo: "a", usage: { tokensIn: 2000, tokensOut: 1320 } }, { photo: "b", usage: null }], "gpt-6-luna");
    expect(atGate).toEqual({ calls: 2, billed: 1, averageMicroUsd: 860, overGate: false });
    const past = summarizeScanCost([{ photo: "a", usage: { tokensIn: 2000, tokensOut: 1321 } }], "gpt-6-luna");
    expect(past.overGate).toBe(true);
    expect(summarizeScanCost([{ photo: "a", usage: null }], "gpt-6-luna")).toEqual({ calls: 1, billed: 0, averageMicroUsd: null, overGate: false });
  });
});
