// Find exercises (63b). The worst thing it could do is a false count: "Show 2 exercises" that opens 1, or a choice
// saying 3 that leaves 2. So the first test checks every choice's count against the list it then gives, in many
// states, over the real exercise files and exercises made from them.
import { readdirSync, readFileSync } from "node:fs";
import { readPhoneLibrary, type PhoneLibraryEntry } from "@app/shared";
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  choicesOf,
  countWith,
  FILTER_GROUPS,
  drawnMuscle,
  NO_EQUIPMENT,
  NO_FILTERS,
  pickedCount,
  pickedShapes,
  roleOf,
  toggle,
  valuesOf,
  type Filters,
} from "../src/library/filters";

const FOLDER = new URL("../../../packages/shared/library/exercises/", import.meta.url);

function realList(): PhoneLibraryEntry[] {
  const exercises = readdirSync(FOLDER).map((name) => ({ ...(JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as object), status: "live", met: 3 }));
  const read = readPhoneLibrary({ fingerprint: "a".repeat(64), version: 1, list: { exercises, camera: [] } });
  if (read === null) throw new Error("the real Library could not be read");
  return read.exercises;
}
const REAL = realList();
const real = (id: string): PhoneLibraryEntry => {
  const found = REAL.find((e) => e.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};
function made(id: string, change: Partial<PhoneLibraryEntry>): PhoneLibraryEntry {
  const p = real("plank");
  return { ...p, ...change, id, text: { en: { ...p.text.en, name: id } } };
}

/** The real three, and exercises that reach the cases they cannot: two pieces of equipment, an advanced level, a
 *  kind and a word this phone does not know, a deep muscle alone, a muscle only steadying. */
const LIST: PhoneLibraryEntry[] = [
  ...REAL,
  made("db_bench", { kind: "strength", level: "advanced", equipment: ["dumbbell", "bench"], muscles: { main: ["upper_chest", "lower_chest"], also: ["front_delts", "triceps_long"], steady: ["abs"] } }),
  made("goblet_squat", { kind: "strength", level: "beginner", equipment: ["kettlebell"], muscles: { main: ["rectus_femoris", "vastus_lateralis", "glute_max"], also: [], steady: [] } }),
  made("cat_cow", { kind: "mobility", level: "beginner", equipment: ["mat"], muscles: { main: ["lower_back"], also: ["abs"], steady: [] } }),
  made("dead_bug", { kind: "pilates", level: "beginner", equipment: [], muscles: { main: ["transverse_abdominis"], also: [], steady: ["hip_flexors"] } }),
  made("sled_push", { kind: "conditioning", level: "elite", equipment: ["sled"], muscles: { main: ["quadratus_lumborum"], also: [], steady: [] } }),
];

describe("a choice's count is what the list then shows (the worst thing: a false count)", () => {
  // States: nothing picked, one choice, two in one group, choices in two groups, and one that leaves nothing.
  const states: Filters[] = [
    NO_FILTERS,
    { ...NO_FILTERS, muscle: ["vastus_lateralis"] },
    { ...NO_FILTERS, muscle: ["vastus_lateralis", "biceps"] },
    { ...NO_FILTERS, equipment: [NO_EQUIPMENT], level: ["beginner"] },
    { ...NO_FILTERS, kind: ["strength"], muscle: ["upper_chest"], level: ["advanced"] },
    { ...NO_FILTERS, kind: ["mobility"], equipment: ["barbell"] },
    { ...NO_FILTERS, counted: ["hand"], muscle: ["abs"] },
  ];
  it.each(states.map((s, i) => [i, s] as const))("state %i: every choice of every group", (_i, state) => {
    for (const group of FILTER_GROUPS) {
      for (const value of choicesOf(LIST, group)) {
        const said = countWith(LIST, state, group, value);
        // What the list shows once this choice is the group's only one.
        const only: Filters = { ...state, [group]: [value] };
        expect(said, `${group} ${JSON.stringify(value)}`).toBe(applyFilters(LIST, only).length);
        // And once it is added to the group's others: never more than the count said plus what they gave.
        const added = state[group].includes(value) ? state : toggle(state, group, value);
        expect(applyFilters(LIST, added).length).toBeGreaterThanOrEqual(said);
      }
    }
  });

  it("the button's number is the list's length, and every exercise shown passes every group", () => {
    for (const state of states) {
      const shown = applyFilters(LIST, state);
      for (const e of shown) {
        for (const g of FILTER_GROUPS) if (state[g].length > 0) expect(state[g].some((v) => valuesOf(e, g).includes(v))).toBe(true);
      }
      const left = LIST.filter((e) => !shown.includes(e));
      for (const e of left) expect(FILTER_GROUPS.some((g) => state[g].length > 0 && !state[g].some((v) => valuesOf(e, g).includes(v)))).toBe(true);
    }
  });
});

describe("the rule, case by case", () => {
  const ids = (f: Filters) => applyFilters(LIST, f).map((e) => e.id).sort();
  it.each<[string, Filters, string[]]>([
    ["nothing picked: every exercise", NO_FILTERS, LIST.map((e) => e.id).sort()],
    ["two choices in one group mean either", { ...NO_FILTERS, level: ["advanced", "elite"] }, ["db_bench", "sled_push"]],
    ["choices in two groups mean both", { ...NO_FILTERS, level: ["beginner"], equipment: [NO_EQUIPMENT] }, ["dead_bug", "squat"]],
    ["No equipment is only the exercises that need none", { ...NO_FILTERS, equipment: [NO_EQUIPMENT] }, ["dead_bug", "plank", "squat"]],
    ["an exercise with two pieces is found by either", { ...NO_FILTERS, equipment: ["bench"] }, ["db_bench"]],
    ["a muscle finds the exercises that work it, main or also", { ...NO_FILTERS, muscle: ["triceps_long"] }, ["db_bench"]],
    ["the exact muscle tapped, never its whole group: the vastus medialis", { ...NO_FILTERS, muscle: ["vastus_medialis"] }, ["squat"]],
    ["the vastus lateralis is worked by both squats", { ...NO_FILTERS, muscle: ["vastus_lateralis"] }, ["goblet_squat", "squat"]],
    ["the other triceps head is not the long head", { ...NO_FILTERS, muscle: ["triceps_lateral"] }, []],
    ["a muscle only steadying does not count: a bench press is not an abs exercise", { ...NO_FILTERS, muscle: ["abs"] }, ["cat_cow", "dead_bug", "plank"]],
    ["a deep muscle counts under the drawn one over it", { ...NO_FILTERS, muscle: ["abs"], kind: ["pilates"] }, ["dead_bug"]],
    ["a word this phone does not know is still a choice", { ...NO_FILTERS, kind: ["conditioning"] }, ["sled_push"]],
    ["a choice that leaves nothing shows nothing", { ...NO_FILTERS, kind: ["mobility"], equipment: ["barbell"] }, []],
    ["every one is counted by hand today", { ...NO_FILTERS, counted: ["hand"] }, LIST.map((e) => e.id).sort()],
    ["no camera choice finds anything today", { ...NO_FILTERS, counted: ["camera_counts"] }, []],
  ])("%s", (_name, filters, expected) => {
    expect(ids(filters)).toEqual(expected);
  });

  it("the choices offered are only what the Library holds, in the lists' order, unknown words after", () => {
    expect(choicesOf(LIST, "equipment")).toEqual([NO_EQUIPMENT, "barbell", "dumbbell", "kettlebell", "bench", "mat", "sled"]);
    expect(choicesOf(LIST, "level")).toEqual(["beginner", "intermediate", "advanced", "elite"]);
    expect(choicesOf(LIST, "kind")).toEqual(["strength", "mobility", "pilates", "conditioning"]);
    expect(choicesOf(LIST, "counted")).toEqual(["hand"]);
    expect(choicesOf(REAL, "muscle")).toEqual(expect.arrayContaining(["abs", "biceps", "vastus_lateralis", "glute_max"]));
    expect(choicesOf(REAL, "muscle")).not.toContain("transverse_abdominis");
  });

  it("a muscle is picked as itself; a deep one as the drawn muscle over it", () => {
    expect(drawnMuscle("vastus_medialis")).toBe("vastus_medialis");
    expect(drawnMuscle("transverse_abdominis")).toBe("abs");
    expect(drawnMuscle("rotator_cuff")).toBe("infraspinatus");
    expect([...pickedShapes({ ...NO_FILTERS, muscle: ["vastus_lateralis"] }).entries()]).toEqual([["vastus_lateralis", "main"]]);
  });

  it("an exercise says whether it works the muscle mainly or also", () => {
    expect(roleOf(real("squat"), "vastus_lateralis")).toBe("Primary");
    expect(roleOf(real("squat"), "biceps_femoris")).toBe("Secondary");
    expect(roleOf(real("plank"), "abs")).toBe("Primary");
  });

  it("toggle picks and lets go; the badge counts every choice", () => {
    const once = toggle(NO_FILTERS, "level", "beginner");
    expect(once.level).toEqual(["beginner"]);
    expect(toggle(once, "level", "beginner").level).toEqual([]);
    expect(pickedCount(toggle(toggle(once, "muscle", "abs"), "equipment", NO_EQUIPMENT))).toBe(3);
    expect(pickedCount(NO_FILTERS)).toBe(0);
  });
});
