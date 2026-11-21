// An exercise's records on its page (63c), as a table over every class of case. A false picture is the fault this
// guards: a bar drawn loaded with a weight it does not hold, a bar marked as the record day that is not, a one-rep
// max shown below the weight already lifted.
import { readdirSync, readFileSync } from "node:fs";
import { readPhoneLibrary, type ExerciseRecords, type PhoneLibraryEntry, type RecentWorkout } from "@app/shared";
import { describe, expect, it } from "vitest";
import {
  BAR_KG,
  BAR_LIGHTS,
  barsOf,
  clockWords,
  dayWords,
  holdWords,
  leadOf,
  loadedBar,
  oneRepMaxGrams,
  platesFor,
  PLATES_KG,
  recordsPath,
  SLEEVE_ROOM,
  sleeveTaken,
  weightParts,
  wholeWeight,
} from "../src/library/records";

const FOLDER = new URL("../../../packages/shared/library/exercises/", import.meta.url);
function real(id: string): PhoneLibraryEntry {
  const exercises = readdirSync(FOLDER).map((name) => ({ ...(JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as object), status: "live", met: 3 }));
  const entry = readPhoneLibrary({ fingerprint: "a".repeat(64), version: 1, list: { exercises, camera: [] } })?.exercises.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no ${id} in the real Library`);
  return entry;
}

const W = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`;
const set = (workout: number, done: number, weightGrams: number | null = null) => ({ workoutId: W(workout), startedAt: at(workout), position: 0, done, weightGrams });
const recent = (workout: number, over: { heaviestGrams?: number | null; mostReps?: number | null; longestHold?: number | null } = {}): RecentWorkout => ({
  workoutId: W(workout),
  startedAt: at(workout),
  reps: { heaviestGrams: over.heaviestGrams ?? null, mostReps: over.mostReps ?? null },
  time: { longestHold: over.longestHold ?? null, heaviestGrams: null },
});
/** The day the server tells for workout n: its own day, here the 1st to the 28th of November. */
const DAY = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
const records = (over: Partial<{ reps: Partial<ExerciseRecords["reps"]>; time: Partial<ExerciseRecords["time"]>; recent: RecentWorkout[] }> = {}): ExerciseRecords => ({
  exercise: "barbell_curl",
  reps: { heaviest: null, mostReps: null, bestEstimated1rm: null, mostLifted: null, ...over.reps },
  time: { longestHold: null, heaviest: null, ...over.time },
  recent: over.recent ?? [],
  days: Object.fromEntries(Array.from({ length: 28 }, (_, i) => [W(i + 1), DAY(i + 1)])),
  limitedToDays: null,
});

describe("the loaded bar holds exactly the weight it says, or is not drawn", () => {
  const curl = real("barbell_curl");
  const plank = real("plank");
  const kgOf = (side: readonly number[]) => BAR_KG + 2 * side.reduce((a, b) => a + b, 0);

  it("every weight from 20 to 180 kg by the half kilo a side: its plates add up to it exactly", () => {
    for (let kg = 20; kg <= 180; kg += 1) {
      const bar = loadedBar(curl, "metric", kg * 1000, null);
      expect(bar, `${String(kg)} kg`).not.toBeNull();
      expect(kgOf(bar?.side ?? [])).toBe(kg);
    }
  });

  it("every weight a set may hold, to 1,000 kg, with any estimate: a bar drawn holds every plate on its sleeve, or none is drawn", () => {
    for (let kg = 20; kg <= 1000; kg += 0.5) {
      for (const more of [0, 0.03, 0.1, 0.33]) {
        const bar = loadedBar(curl, "metric", kg * 1000, Math.round(kg * (1 + more) * 1000));
        if (bar === null) continue;
        expect(kgOf(bar.side), `${String(kg)} kg`).toBe(kg);
        expect(sleeveTaken(bar.side) + sleeveTaken(bar.extra), `${String(kg)} kg, +${String(more)}`).toBeLessThanOrEqual(SLEEVE_ROOM);
      }
    }
  });

  it("the review's cases: 183.5 kg does not fit, so no bar; 160 kg x 5 keeps its plates and leaves off the estimate's", () => {
    expect(loadedBar(curl, "metric", 183_500, null)).toBeNull();
    expect(loadedBar(curl, "metric", 160_000, 186_666)).toEqual({ side: [25, 25, 20], extra: [] });
    expect(loadedBar(curl, "metric", 1_000_000, null)).toBeNull();
  });

  it("the drawing's own: 35 kg is a 5 and a 2.5 a side; 44 kg's estimate adds a 2.5 and a 2 beyond them", () => {
    expect(loadedBar(curl, "metric", 35_000, 44_000)).toEqual({ side: [5, 2.5], extra: [2.5, 2] });
  });

  it.each([
    ["under the bar's own weight", 15_000],
    ["a weight no plates make (33.3 kg)", 33_300],
    ["an odd half kilo (20.5 kg)", 20_500],
  ])("no bar for %s", (_why, grams) => {
    expect(loadedBar(curl, "metric", grams, null)).toBeNull();
  });

  it("no bar in pounds, nor for an exercise that is not done with a barbell", () => {
    expect(loadedBar(curl, "imperial", 60_000, null)).toBeNull();
    expect(loadedBar(plank, "metric", 60_000, null)).toBeNull();
    expect(loadedBar({ ...curl, equipment: ["ez_curl_bar"] }, "metric", 60_000, null)).toBeNull();
  });

  it("the estimate's plates go no further than the estimate: rounded down to the half kilo a side", () => {
    // 40 kg lifted, 43.7 kg estimated: 1.85 kg a side, so 1.5 kg a side is drawn, never 2.
    const bar = loadedBar(curl, "metric", 40_000, 43_700);
    expect(bar?.extra).toEqual([1.5]);
    expect(loadedBar(curl, "metric", 40_000, 40_000)?.extra).toEqual([]);
    expect(loadedBar(curl, "metric", 40_000, null)?.extra).toEqual([]);
  });

  it("every 2.5 kg from the empty bar draws plates that add up to it, the 1.25 change plate included, until the sleeve is full", () => {
    // Found on Kd's phone (64a-i): 22.5 kg needed a 1.25 kg plate a side, which the list did not have.
    let kg = 20;
    for (; kg <= 400; kg += 2.5) {
      const bar = loadedBar(curl, "metric", kg * 1000, null);
      if (bar === null) break;
      expect(kgOf(bar.side), `${String(kg)} kg`).toBeCloseTo(kg, 6);
    }
    expect(kg).toBeGreaterThan(180);
    expect(loadedBar(curl, "metric", 22_500, null)?.side).toEqual([1.25]);
  });

  it("plates are largest first, and only the standard ones", () => {
    expect(platesFor(47.5)).toEqual([25, 20, 2.5]);
    expect(platesFor(3.75)).toEqual([2.5, 1.25]);
    expect(platesFor(0)).toEqual([]);
    expect(platesFor(0.3)).toBeNull();
    for (let half = 0; half <= 200; half++) for (const p of platesFor(half / 2) ?? []) expect(PLATES_KG).toContain(p);
  });
});

describe("which record leads", () => {
  it.each([
    ["reps, with a weight lifted", "reps", { reps: { heaviest: set(1, 8, 35_000), mostReps: set(1, 8, 35_000) } }, "heaviest"],
    ["reps, bodyweight only", "reps", { reps: { mostReps: set(1, 24) } }, "mostReps"],
    ["time", "time", { time: { longestHold: set(1, 75) } }, "longestHold"],
    ["time, with only old sets in reps", "time", { reps: { mostReps: set(1, 12) } }, "mostReps"],
    ["reps, with only old holds", "reps", { time: { longestHold: set(1, 40) } }, "longestHold"],
    ["nothing done", "reps", {}, null],
  ] as const)("%s", (_why, measuredIn, over, lead) => {
    expect(leadOf(measuredIn, records(over))).toBe(lead);
  });
});

describe("the bars of the last times", () => {
  const r = records({
    reps: { heaviest: set(14, 8, 35_000), mostReps: set(2, 15, 20_000) },
    recent: [recent(2, { heaviestGrams: 25_000, mostReps: 15 }), recent(6, { heaviestGrams: 30_000, mostReps: 10 }), recent(14, { heaviestGrams: 35_000, mostReps: 8 })],
  });

  it("each lit as far as it came to the record; only the record's own workout is marked", () => {
    const bars = barsOf("heaviest", r);
    expect(bars.map((b) => b.lit)).toEqual([6, 7, BAR_LIGHTS]);
    expect(bars.map((b) => b.record)).toEqual([false, false, true]);
    expect(bars.map((b) => b.day)).toEqual(["2 Nov", "6 Nov", "14 Nov"]);
  });

  it("a record made before the last times marks none of them", () => {
    const older = records({ reps: { heaviest: set(1, 3, 50_000) }, recent: [recent(6, { heaviestGrams: 30_000 })] });
    expect(barsOf("heaviest", older).map((b) => b.record)).toEqual([false]);
  });

  it("a workout that did none of the leading kind has no lights; anything done has at least one", () => {
    const thin = records({ reps: { heaviest: set(14, 8, 100_000) }, recent: [recent(3, { mostReps: 20 }), recent(4, { heaviestGrams: 2_000 })] });
    expect(barsOf("heaviest", thin).map((b) => [b.value, b.lit])).toEqual([[null, 0], [2_000, 1]]);
  });

  it("most reps and holds lead their own bars", () => {
    expect(barsOf("mostReps", r).map((b) => b.record)).toEqual([true, false, false]);
    const hold = records({ time: { longestHold: set(12, 75) }, recent: [recent(9, { longestHold: 60 }), recent(12, { longestHold: 75 })] });
    expect(barsOf("longestHold", hold).map((b) => [b.lit, b.record])).toEqual([[6, false], [8, true]]);
  });
});

describe("the one-rep max", () => {
  it("is shown where it is the heaviest or more", () => {
    expect(oneRepMaxGrams(records({ reps: { heaviest: set(1, 8, 35_000), bestEstimated1rm: { ...set(1, 8, 35_000), estimateGrams: 44_333 } } }))).toBe(44_333);
  });
  it("never below the weight already lifted (the heaviest set was past ten reps)", () => {
    expect(oneRepMaxGrams(records({ reps: { heaviest: set(1, 12, 100_000), bestEstimated1rm: { ...set(2, 5, 80_000), estimateGrams: 93_333 } } }))).toBeNull();
  });
  it("none where there is no estimate", () => {
    expect(oneRepMaxGrams(records({ reps: { heaviest: set(1, 12, 100_000) } }))).toBeNull();
  });
});

describe("words and digits", () => {
  it.each([
    [35_000, "metric", ["35", "kg"]],
    [32_500, "metric", ["32.5", "kg"]],
    [32_500, "imperial", ["71.7", "lb"]],
    [45_359, "imperial", ["100", "lb"]],
  ] as const)("%s g in %s", (grams, units, parts) => {
    expect(weightParts(grams, units)).toEqual(parts);
  });
  it("a big weight is whole: 880 kg, 1940 lb", () => {
    expect(wholeWeight(880_000, "metric")).toEqual(["880", "kg"]);
    expect(wholeWeight(880_000, "imperial")).toEqual(["1940", "lb"]);
  });
  it.each([
    [45, "0:45", "45 s"],
    [75, "1:15", "1:15"],
    [3725, "1:02:05", "1:02:05"],
  ])("%s seconds", (s, clock, words) => {
    expect(clockWords(s)).toBe(clock);
    expect(holdWords(s)).toBe(words);
  });
  it("a day is the server's own, never worked out on the phone: 2026-11-14 is 14 Nov whatever the phone's zone", () => {
    expect(dayWords("2026-11-14")).toBe("14 Nov");
    expect(dayWords("2026-01-02")).toBe("2 Jan");
    expect(dayWords(undefined)).toBe("");
    expect(dayWords("14 Nov")).toBe("");
  });

  it("the records' address carries the exercise's id word, escaped", () => {
    expect(recordsPath("barbell_curl")).toBe("/v1/training/exercises/barbell_curl/records");
  });
});
