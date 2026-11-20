// Setting up an exercise's sets in My Workout (64a-i), as a table over every class of case. The faults this guards: a
// press that leaves a set outside what a workout's save takes, a row that says other numbers than the sets hold, a
// typed weight read wrongly, and an estimate in calories at a weight that is not the person's.
import { readdirSync, readFileSync } from "node:fs";
import { KCAL_REST_MET, readPhoneLibrary, WORKOUT_SAVE_LIMITS, type PhoneLibraryEntry, type PlannedSet } from "@app/shared";
import { describe, expect, it } from "vitest";
import { SETS_MOST, type Item, type Plan } from "../src/library/myWorkout";
import {
  BAR_LB,
  canStep,
  changed,
  clockDigits,
  estimate,
  minutesWords,
  planLine,
  planOf,
  typedWeight,
  withWeight,
  REST_MOST,
  REST_START,
  same,
  startPlan,
  stepTime,
  stepWeight,
  summaryLine,
  TIME_LEAST,
  TIME_MOST,
} from "../src/library/workoutSetup";

const FOLDER = new URL("../../../packages/shared/library/exercises/", import.meta.url);
const METS: Record<string, number> = { squat: 3, plank: 2.8, barbell_curl: 3.5 };
function library(over: Record<string, object> = {}): PhoneLibraryEntry[] {
  const exercises = readdirSync(FOLDER).map((name) => {
    const file = JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as { id: string };
    return { ...file, status: "live", met: METS[file.id] ?? 3, ...(over[file.id] ?? {}) };
  });
  return readPhoneLibrary({ fingerprint: "a".repeat(64), version: 1, list: { exercises, camera: [] } })?.exercises ?? [];
}
function real(id: string, over: object = {}): PhoneLibraryEntry {
  const entry = library({ [id]: over }).find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no ${id} in the real Library`);
  return entry;
}
const curl = real("barbell_curl");
const squat = real("squat");
const plank = real("plank");
const S = (target: number, weightGrams: number | null = null, restSeconds: number | null = 60): PlannedSet => ({ target, weightGrams, restSeconds });
const reps = (...sets: PlannedSet[]): Plan => ({ measuredIn: "reps", sets });
const time = (...sets: PlannedSet[]): Plan => ({ measuredIn: "time", sets });

describe("the Library's starting numbers", () => {
  it("each real exercise starts at its own file's sets, reps or time, no weight and 60 s of rest", () => {
    expect(startPlan(curl)).toEqual(reps(S(10), S(10), S(10)));
    expect(startPlan(squat)).toEqual(reps(S(12), S(12), S(12)));
    expect(startPlan(plank)).toEqual(time(S(30), S(30), S(30)));
    expect(REST_START).toBe(60);
  });

  it("an exercise the phone reads with more sets than a set-up takes starts at the most; one with no target has none", () => {
    expect(startPlan({ ...squat, set: { ...squat.set, start: { sets: 40, reps: 5 } } })?.sets).toHaveLength(SETS_MOST);
    expect(startPlan({ ...squat, set: { ...squat.set, start: { sets: 3 } } })).toBeNull();
  });

  it("the person's own sets win over the Library's; an exercise the phone cannot read has none", () => {
    const mine = reps(S(6, 25_000));
    expect(planOf({ id: "barbell_curl", plan: mine }, curl)).toBe(mine);
    expect(planOf({ id: "barbell_curl", plan: null }, curl)).toEqual(startPlan(curl));
    expect(planOf({ id: "gone", plan: null }, null)).toBeNull();
  });
});

describe("a weight typed by the person", () => {
  const ok = (grams: number | null) => ({ kind: "ok", grams });
  it.each<[string, string, "metric" | "imperial", object]>([
    ["a whole number", "50", "metric", ok(50_000)],
    ["a half", "47.5", "metric", ok(47_500)],
    ["a comma for the point", "47,5", "metric", ok(47_500)],
    ["spaces round it", " 22.5 ", "metric", ok(22_500)],
    ["empty is no weight", "", "metric", ok(null)],
    ["0 is no weight", "0", "metric", ok(null)],
    ["in pounds", "135", "imperial", ok(Math.round(135 * 453.59237))],
    ["the most a save allows", "1000", "metric", ok(1_000_000)],
    // The screen shows one decimal, so a typed weight has one at most: never "22.3 kg" for 22.25 (review L1).
    ["two decimals", "22.25", "metric", { kind: "unread" }],
    ["more than a save allows", "1000.5", "metric", { kind: "heavy" }],
    ["far more", "99999", "metric", { kind: "heavy" }],
    ["a thousands comma (read as a point, 1.000)", "1,000", "metric", { kind: "unread" }],
    ["words", "fifty", "metric", { kind: "unread" }],
    ["a minus", "-5", "metric", { kind: "unread" }],
    ["two points", "4.5.5", "metric", { kind: "unread" }],
  ])("%s", (_, text, units, want) => {
    expect(typedWeight(text, units)).toEqual(want);
  });

  it("goes to one set, or to every set; the same plan where nothing changes", () => {
    const p = reps(S(10, 20_000), S(10, 25_000));
    expect(withWeight(p, 47_500, null)).toEqual(reps(S(10, 47_500), S(10, 47_500)));
    expect(withWeight(p, 47_500, 1)).toEqual(reps(S(10, 20_000), S(10, 47_500)));
    expect(withWeight(p, null, 0)).toEqual(reps(S(10), S(10, 25_000)));
    expect(withWeight(p, 20_000, 0)).toBe(p);
  });
});

describe("one press of + or −", () => {
  it.each<[string, number, -1 | 1, number]>([
    ["5 s up under a minute", 30, 1, 35],
    ["5 s down to a minute", 60, -1, 55],
    ["15 s up from a minute", 60, 1, 75],
    ["15 s down back to a minute", 75, -1, 60],
    ["15 s down to five minutes", 300, -1, 285],
    ["30 s up from five minutes", 300, 1, 330],
    ["30 s down back to five minutes", 330, -1, 300],
    ["never under 5 s", TIME_LEAST, -1, TIME_LEAST],
    ["never past an hour", TIME_MOST, 1, TIME_MOST],
    ["a time off the steps keeps its own seconds", 37, 1, 42],
  ])("time: %s", (_, from, by, want) => {
    expect(stepTime(from, by)).toBe(want);
  });

  it.each<[string, number | null, -1 | 1, "metric" | "imperial", boolean, number | null]>([
    ["a barbell from none is the empty 20 kg bar", null, 1, "metric", true, 20_000],
    ["from the empty bar, − is none", 20_000, -1, "metric", true, null],
    ["2.5 kg a press on the bar", 20_000, 1, "metric", true, 22_500],
    ["a weight under the bar (from an older list) − is none", 15_000, -1, "metric", true, null],
    ["anything else from none is 2.5 kg", null, 1, "metric", false, 2_500],
    ["2.5 kg − is none", 2_500, -1, "metric", false, null],
    ["a barbell in pounds from none is the 45 lb bar", null, 1, "imperial", true, Math.round(BAR_LB * 453.59237)],
    ["5 lb a press", Math.round(45 * 453.59237), 1, "imperial", true, Math.round(50 * 453.59237)],
    ["from none, − stays none", null, -1, "metric", false, null],
    ["never past a save's limit", WORKOUT_SAVE_LIMITS.weightGramsMost, 1, "metric", false, WORKOUT_SAVE_LIMITS.weightGramsMost],
  ])("weight: %s", (_, from, by, units, barbell, want) => {
    expect(stepWeight(from, by, units, barbell)).toBe(want);
  });

  it("five pounds up and five down comes back to the same grams, so a set never drifts", () => {
    let g: number | null = Math.round(135 * 453.59237);
    const start = g;
    for (let i = 0; i < 20; i++) g = stepWeight(g, 1, "imperial", true);
    for (let i = 0; i < 20; i++) g = stepWeight(g, -1, "imperial", true);
    expect(g).toBe(start);
  });

  it("every set at once: each takes the first set's number after the press, the field pressed only (Kd's click-through)", () => {
    // What the controls show is the first set's, so that is what every set then holds: never "--" with a press unseen.
    const p = reps(S(10, 20_000), S(8, 25_000, 90));
    expect(changed(p, "target", 1, null, "metric", true)).toEqual(reps(S(11, 20_000), S(11, 25_000, 90)));
    expect(changed(p, "weight", 1, null, "metric", true)).toEqual(reps(S(10, 22_500), S(8, 22_500, 90)));
    expect(changed(p, "rest", -1, null, "metric", true)).toEqual(reps(S(10, 20_000, 45), S(8, 25_000, 45)));
    // At the first set's limit, a press still makes the others the same as it.
    const low = reps(S(1), S(6));
    expect(changed(low, "target", -1, null, "metric", false)).toEqual(reps(S(1), S(1)));
    const even = reps(S(1), S(1));
    expect(changed(even, "target", -1, null, "metric", false)).toBe(even);
  });

  it("one set alone: the others stay as they are", () => {
    const p = reps(S(10, 20_000), S(10, 20_000), S(10, 20_000));
    expect(changed(p, "weight", 1, 2, "metric", true)).toEqual(reps(S(10, 20_000), S(10, 20_000), S(10, 22_500)));
    expect(changed(p, "target", -1, 0, "metric", true).sets.map((s) => s.target)).toEqual([9, 10, 10]);
  });

  it("a set is added as a copy of the last, and taken from the end; one set at least, ten at most", () => {
    const p = reps(S(10, 20_000), S(6, 25_000, 90));
    expect(changed(p, "sets", 1, null, "metric", true)).toEqual(reps(S(10, 20_000), S(6, 25_000, 90), S(6, 25_000, 90)));
    expect(changed(p, "sets", -1, null, "metric", true)).toEqual(reps(S(10, 20_000)));
    const one = reps(S(10));
    expect(changed(one, "sets", -1, null, "metric", false)).toBe(one);
    const full = reps(...Array.from({ length: SETS_MOST }, () => S(5)));
    expect(changed(full, "sets", 1, null, "metric", false)).toBe(full);
  });

  it.each<[string, Plan, "sets" | "target" | "weight" | "rest", -1 | 1]>([
    ["one rep, −", reps(S(1)), "target", -1],
    ["a save's most reps, +", reps(S(WORKOUT_SAVE_LIMITS.repsMost)), "target", 1],
    ["no rest, −", reps(S(10, null, 0)), "rest", -1],
    ["the most rest, +", reps(S(10, null, REST_MOST)), "rest", 1],
    ["no weight, −", reps(S(10)), "weight", -1],
  ])("at a limit nothing changes, and the button says so: %s", (_, p, field, by) => {
    expect(changed(p, field, by, null, "metric", false)).toBe(p);
    expect(canStep(p, field, by, null, "metric", false)).toBe(false);
    expect(canStep(p, field, by === 1 ? -1 : 1, null, "metric", false) || field === "weight").toBe(true);
  });

  it("no press ever gives a plan a saved workout would refuse", () => {
    // From every limit, every field, both ways, every set and each set alone.
    const starts: Plan[] = [reps(S(1, null, 0)), reps(S(WORKOUT_SAVE_LIMITS.repsMost, WORKOUT_SAVE_LIMITS.weightGramsMost, REST_MOST)), time(S(TIME_LEAST, null, 0)), time(S(TIME_MOST, 1, REST_MOST), S(30))];
    for (const p of starts) {
      for (const field of ["sets", "target", "weight", "rest"] as const) {
        for (const by of [-1, 1] as const) {
          for (const which of [null, 0]) {
            for (const s of changed(p, field, by, which, "metric", false).sets) {
              expect(s.target).toBeGreaterThanOrEqual(1);
              expect(s.target).toBeLessThanOrEqual(p.measuredIn === "time" ? WORKOUT_SAVE_LIMITS.secondsMost : WORKOUT_SAVE_LIMITS.repsMost);
              if (s.weightGrams !== null) expect(s.weightGrams).toBeGreaterThanOrEqual(1);
              if (s.weightGrams !== null) expect(s.weightGrams).toBeLessThanOrEqual(WORKOUT_SAVE_LIMITS.weightGramsMost);
              expect(s.restSeconds ?? 0).toBeLessThanOrEqual(WORKOUT_SAVE_LIMITS.restSecondsMost);
            }
          }
        }
      }
    }
  });
});

describe("what a row says is what its sets hold", () => {
  it.each<[string, Plan, "metric" | "imperial", boolean, string]>([
    ["all the same", reps(S(10, 20_000), S(10, 20_000), S(10, 20_000)), "metric", false, "3 × 10 reps · 20 kg · rest 1:00"],
    ["no weight", reps(S(12), S(12), S(12)), "metric", false, "3 × 12 reps · rest 1:00"],
    ["reps that differ", reps(S(10, 20_000), S(10, 20_000), S(6, 25_000, 90)), "metric", false, "3 sets · 10, 10, 6 reps · 20 to 25 kg · rest varies"],
    ["a weight on some sets only", reps(S(10), S(10, 5_000)), "metric", false, "2 × 10 reps · 5 kg on some sets · rest 1:00"],
    ["weights that differ, and a set with none (review L4)", reps(S(10), S(10, 20_000), S(10, 25_000)), "metric", false, "3 × 10 reps · 20 to 25 kg on some sets · rest 1:00"],
    ["one set, one rep", reps(S(1, null, 0)), "metric", false, "1 × 1 rep · no rest"],
    ["time", time(S(30, null, 45), S(30, null, 45)), "metric", false, "2 × 30 s · rest 0:45"],
    ["times that differ", time(S(30), S(75)), "metric", false, "2 sets · 30 s, 1:15 · rest 1:00"],
    ["each side", reps(S(8), S(8)), "metric", true, "2 × 8 reps each side · rest 1:00"],
    ["in pounds", reps(S(5, Math.round(135 * 453.59237))), "imperial", false, "1 × 5 reps · 135 lb · rest 1:00"],
  ])("%s", (_, p, units, eachSide, want) => {
    expect(planLine(p, units, eachSide)).toBe(want);
  });

  it("'the same' is read field by field", () => {
    const p = reps(S(10, 20_000, 60), S(10, 25_000, 60));
    expect([same(p, "target"), same(p, "weight"), same(p, "rest")]).toEqual([true, false, true]);
  });

  it("the timer's digits", () => {
    expect([clockDigits(30), clockDigits(75), clockDigits(3600), clockDigits(0)]).toEqual(["00:30", "01:15", "60:00", "00:00"]);
  });
});

describe("about how long, and how many calories", () => {
  const entryOf = (id: string) => ({ barbell_curl: curl, squat, plank } as Record<string, PhoneLibraryEntry>)[id] ?? null;
  const items: Item[] = [{ id: "barbell_curl", plan: null }, { id: "plank", plan: time(S(30, null, 45)) }];

  it("a rep is 3 s, a time its own seconds, the rest after every set but the very last; calories as a saved workout reckons them", () => {
    // Curl: 3 × (30 s + 60 s rest) = 270 s; plank: 30 s, its rest left out as nothing follows it (review L5). 300 s.
    const kcal = (3.5 * 82 * 90 + KCAL_REST_MET * 82 * 180 + 2.8 * 82 * 30) / 3600;
    expect(estimate(items, entryOf, 82)).toEqual({ minutes: 5, kcal: Math.round(kcal), assumedKg: null });
  });

  it("the last rest left out is the last exercise that can be read, not one the phone cannot", () => {
    const withGone: Item[] = [...items, { id: "gone", plan: null }];
    expect(estimate(withGone, entryOf, 82)).toEqual(estimate(items, entryOf, 82));
  });

  it("no weight given: at 70 kg, and said so (review H2); the weight not heard yet: no calories at all", () => {
    const none = estimate(items, entryOf, null);
    expect(none.kcal).toBe(estimate(items, entryOf, 70).kcal);
    expect(none.assumedKg).toBe(70);
    expect(summaryLine(2, none, "metric")).toBe(`2 exercises · about 5 min · about ${String(none.kcal)} kcal at 70 kg`);
    expect(summaryLine(2, none, "imperial")).toBe(`2 exercises · about 5 min · about ${String(none.kcal)} kcal at 154.3 lb`);
    expect(estimate(items, entryOf, 0).assumedKg).toBe(70);
    expect(estimate(items, entryOf, undefined)).toMatchObject({ kcal: null, assumedKg: null });
  });

  it("each side counts twice; an exercise the phone cannot read is left out; a MET not known says no calories", () => {
    const sided = { ...squat, set: { ...squat.set, eachSide: true } };
    const one: Item[] = [{ id: "squat", plan: reps(S(10, null, 0), S(10, null, 0)) }];
    expect(estimate(one, () => sided, 70).minutes).toBe(2);
    expect(estimate(one, () => squat, 70).minutes).toBe(1);
    expect(estimate([...one, { id: "gone", plan: null }], (id) => (id === "squat" ? squat : null), 70)).toEqual(estimate(one, () => squat, 70));
    expect(estimate(one, () => ({ ...squat, met: null }), 70).kcal).toBeNull();
  });

  it("the line under the name", () => {
    expect(summaryLine(3, { minutes: 14, kcal: 95, assumedKg: null }, "metric")).toBe("3 exercises · about 14 min · about 95 kcal");
    expect(summaryLine(1, { minutes: 6, kcal: null, assumedKg: null }, "metric")).toBe("1 exercise · about 6 min");
    expect(summaryLine(2, { minutes: 0, kcal: 0, assumedKg: null }, "metric")).toBe("2 exercises");
    expect([minutesWords(59), minutesWords(60), minutesWords(65)]).toEqual(["about 59 min", "about 1 h", "about 1 h 5 min"]);
  });
});
