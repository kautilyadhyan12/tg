// The cool-down stretches after a workout (job 64a-iii), and the summary's shapes. The stretches are picked from
// the main muscles of the workout's exercises. The cases come from the Library's real exercise files, and from
// muscle words no rule names and words the phone has never heard of, so the table is not the rule's own list
// checked against itself.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stretchesFor, workoutAfterSchema, workoutEffortSchema } from "../src/library/workoutAfter.js";
import { EXERCISE_MUSCLES } from "../src/library/words.js";

const EXERCISES = new URL("../library/exercises/", import.meta.url);
const mainOf = (file: string): string[] => {
  const parsed: unknown = JSON.parse(readFileSync(new URL(file, EXERCISES), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("muscles" in parsed)) throw new Error(`${file}: no muscles`);
  const muscles: unknown = parsed.muscles;
  if (typeof muscles !== "object" || muscles === null || !("main" in muscles) || !Array.isArray(muscles.main)) throw new Error(`${file}: no main muscles`);
  return muscles.main.map(String);
};
const names = (muscles: readonly string[]) => stretchesFor(muscles).map((s) => s.name);
const WHOLE = ["Full body stretch", "Child's pose", "Neck rolls"];

describe("stretchesFor", () => {
  it("reads every exercise file the Library holds", () => {
    const files = readdirSync(EXERCISES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(stretchesFor(mainOf(f)).length).toBeGreaterThan(0);
  });

  it.each([
    ["the real squat file: the quadriceps", ["squat.json"], ["Hip flexor stretch"]],
    ["the real plank file: the abs", ["plank.json"], ["Cat-cow stretch"]],
    ["the real barbell curl file: the biceps, which no rule names", ["barbell_curl.json"], WHOLE],
    ["curl, squat and plank together, in the rules' order", ["barbell_curl.json", "plank.json", "squat.json"], ["Hip flexor stretch", "Cat-cow stretch"]],
  ])("%s", (_case, files, want) => {
    expect(names(files.flatMap(mainOf))).toEqual(want);
  });

  it.each([
    ["one quadriceps head alone", ["vastus_medialis"], ["Hip flexor stretch"]],
    ["the glutes", ["glute_med"], ["Hip flexor stretch"]],
    ["the upper chest", ["upper_chest"], ["Chest doorway stretch"]],
    ["a shoulder", ["rear_delts"], ["Chest doorway stretch"]],
    ["the hamstrings", ["inner_hamstrings"], ["Seated hamstring stretch"]],
    ["the obliques", ["obliques"], ["Cat-cow stretch"]],
    ["every rule at once, each once", ["glute_max", "rectus_femoris", "front_delts", "lower_chest", "biceps_femoris", "abs"], ["Hip flexor stretch", "Chest doorway stretch", "Seated hamstring stretch", "Cat-cow stretch"]],
    ["the deep core is not the abs: the rule reads plain names", ["transverse_abdominis"], WHOLE],
    ["calves, lats and triceps: no rule", ["calves", "lats", "triceps_long"], WHOLE],
    ["nothing", [], WHOLE],
    ["a word the phone has never heard of", ["pectoralis_minor"], WHOLE],
    ["a word it does not know beside one it does", ["pectoralis_minor", "upper_chest"], ["Chest doorway stretch"]],
    ["a plain name typed as a muscle word is not a muscle word", ["Quadriceps"], WHOLE],
  ])("%s", (_case, muscles, want) => {
    expect(names(muscles)).toEqual(want);
  });

  it("gives every muscle on the list some stretch, and the whole-body three a fresh list each time", () => {
    for (const m of EXERCISE_MUSCLES) expect(stretchesFor([m]).length).toBeGreaterThan(0);
    const one = stretchesFor([]);
    one.pop();
    expect(stretchesFor([])).toHaveLength(3);
  });

  it("keeps the ported words", () => {
    expect(stretchesFor(["glute_max", "front_delts", "biceps_femoris", "abs"])).toEqual([
      { name: "Hip flexor stretch", howLong: "30 seconds each side" },
      { name: "Chest doorway stretch", howLong: "30 seconds" },
      { name: "Seated hamstring stretch", howLong: "45 seconds" },
      { name: "Cat-cow stretch", howLong: "10 reps" },
    ]);
  });
});

describe("workoutEffortSchema", () => {
  it.each([[1], [3], [5]])("takes %d stars", (effort) => {
    expect(workoutEffortSchema.safeParse({ effort }).success).toBe(true);
  });
  it.each([[0], [6], [2.5], ["3"], [null]])("refuses %s", (effort) => {
    expect(workoutEffortSchema.safeParse({ effort }).success).toBe(false);
  });
  it("refuses anything more", () => {
    expect(workoutEffortSchema.safeParse({ effort: 3, workoutId: "x" }).success).toBe(false);
  });
});

describe("workoutAfterSchema", () => {
  it("reads a summary with no ideas, no records and no weight", () => {
    const view = { total: 50, level: 1, xpInLevel: 50, xpForNext: 100, progressPct: 50, nextLevelAt: 100 };
    const ok = workoutAfterSchema.safeParse({
      workoutId: "7d1f6a52-4a35-4d1b-9b0e-2b6d8b7c1a11",
      kcalPoint: null,
      weightKg: null,
      effort: null,
      xp: { earned: 50, forWorkout: 50, forStreak: 0, view },
      streak: 1,
      records: [],
      food: { ideas: [], caution: "Have a food allergy? Always check the label.", labelCaution: null },
    });
    expect(ok.success).toBe(true);
  });
});
