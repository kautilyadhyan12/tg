// The real Exercise Library, read from its folder as publishing will read it (spec Part 2 §13.4,
// job 60a). This is the check GitHub runs on every change: a faulty file fails here, and the
// failure lists every fault with its file and fact. Run it alone with
//   corepack pnpm --filter @app/shared exec vitest run test/library.files.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkLibrary, faultLine } from "../src/library/check.js";

const LIBRARY = new URL("../library/", import.meta.url);
const EXERCISES = new URL("exercises/", LIBRARY);

function readLibrary() {
  const exerciseFiles = readdirSync(EXERCISES).map((name) => ({ name, text: readFileSync(new URL(name, EXERCISES), "utf8") }));
  const compendium = { name: "compendium.json", text: readFileSync(new URL("compendium.json", LIBRARY), "utf8") };
  return { exerciseFiles, compendium };
}

describe("the Exercise Library's own files", () => {
  const input = readLibrary();
  const checked = checkLibrary(input);

  it("have no fault", () => {
    expect(checked.faults.map(faultLine)).toEqual([]);
  });

  it("are every file in the folder, each handed on", () => {
    expect(checked.exercises.map((e) => `${e.id}.json`)).toEqual(input.exerciseFiles.map((f) => f.name).sort());
    expect(checked.exercises.length).toBeGreaterThan(0);
  });
});
