// The records rule (job 61b, `training/records.ts`), as a table over every class of case: what counts,
// what ties, what a unit keeps apart, and when a workout's set is a "New record". The first block is the
// job's worst thing for a person: being told "New record" for a set that is not one.
import { describe, expect, it } from "vitest";
import { estimatedOneRepMaxGrams, exerciseRecords, liftedOf, newRecordsIn, unitAndDone, type SetFact } from "../src/modules/training/records.js";

const W1 = "00000000-0000-4000-8000-000000000001";
const W2 = "00000000-0000-4000-8000-000000000002";
const W3 = "00000000-0000-4000-8000-000000000003";
const DAY1 = "2026-11-01T08:00:00.000Z";
const DAY2 = "2026-11-02T08:00:00.000Z";
const DAY3 = "2026-11-03T08:00:00.000Z";

const s = (over: Partial<SetFact>): SetFact => ({
  workoutId: W1,
  startedAt: DAY1,
  exercise: "squat",
  position: 0,
  measuredIn: "reps",
  done: 10,
  weightGrams: null,
  ...over,
});

describe("never 'New record' for a set that is not one", () => {
  const before = [s({ weightGrams: 100_000, done: 5 })];
  it.each([
    ["the same weight as before", [s({ workoutId: W2, startedAt: DAY2, weightGrams: 100_000, done: 5 })]],
    ["a lighter weight", [s({ workoutId: W2, startedAt: DAY2, weightGrams: 99_999, done: 5 })]],
    ["a heavier set of nothing done", [s({ workoutId: W2, startedAt: DAY2, weightGrams: 200_000, done: 0 })]],
    ["a heavier set of another exercise", [s({ workoutId: W2, startedAt: DAY2, exercise: "deadlift", weightGrams: 200_000, done: 5 })]],
  ])("%s is no heaviest record", (_name, workout) => {
    const told = newRecordsIn(workout, before).filter((r) => r.kind === "heaviest" && r.exercise === "squat");
    expect(told).toEqual([]);
  });

  it("the first time an exercise is done, nothing is a record", () => {
    expect(newRecordsIn([s({ weightGrams: 100_000, done: 5 }), s({ position: 1, weightGrams: 120_000, done: 3 })], [])).toEqual([]);
  });

  it("a kind never done before is no record: the first weighted set after sets with no weight", () => {
    const told = newRecordsIn([s({ workoutId: W2, startedAt: DAY2, weightGrams: 20_000, done: 8 })], [s({ done: 10 })]);
    expect(told.map((r) => r.kind)).toEqual([]);
  });

  it("another exercise's past never makes a record of this one", () => {
    const told = newRecordsIn([s({ workoutId: W2, startedAt: DAY2, weightGrams: 50_000, done: 5 })], [s({ exercise: "deadlift", weightGrams: 10_000, done: 5 })]);
    expect(told).toEqual([]);
  });

  it("a hold before never makes a set in reps a record, nor reps a hold", () => {
    const told = newRecordsIn(
      [s({ workoutId: W2, startedAt: DAY2, done: 90 }), s({ workoutId: W2, startedAt: DAY2, position: 1, measuredIn: "time", done: 5 })],
      [s({ measuredIn: "time", done: 60 }), s({ position: 1, done: 3 })],
    );
    expect(told).toEqual([{ exercise: "squat", measuredIn: "reps", kind: "most_reps", position: 0 }]);
  });
});

describe("New record: what is told, and of which set", () => {
  const before = [s({ weightGrams: 100_000, done: 5 }), s({ position: 1, weightGrams: 80_000, done: 10 })];

  it("a heavier set is told, of the set that made it", () => {
    const workout = [s({ workoutId: W2, startedAt: DAY2, weightGrams: 90_000, done: 5 }), s({ workoutId: W2, startedAt: DAY2, position: 1, weightGrams: 105_000, done: 2 })];
    expect(newRecordsIn(workout, before).filter((r) => r.kind === "heaviest")).toEqual([{ exercise: "squat", measuredIn: "reps", kind: "heaviest", position: 1 }]);
  });

  it("two sets of one workout both beating the past: the first of the best is told, once", () => {
    const workout = [
      s({ workoutId: W2, startedAt: DAY2, weightGrams: 110_000, done: 1 }),
      s({ workoutId: W2, startedAt: DAY2, position: 1, weightGrams: 110_000, done: 1 }),
    ];
    expect(newRecordsIn(workout, before).filter((r) => r.kind === "heaviest")).toEqual([{ exercise: "squat", measuredIn: "reps", kind: "heaviest", position: 0 }]);
  });

  it("most lifted is the whole workout's, with no set", () => {
    // Before: 100kg x 5 + 80kg x 10 = 1,300 kg. Now: 70kg x 10 x 2 = 1,400 kg.
    const workout = [s({ workoutId: W2, startedAt: DAY2, weightGrams: 70_000, done: 10 }), s({ workoutId: W2, startedAt: DAY2, position: 1, weightGrams: 70_000, done: 10 })];
    expect(newRecordsIn(workout, before)).toEqual([{ exercise: "squat", measuredIn: "reps", kind: "most_lifted", position: null }]);
  });

  it("each kind is told on its own: more reps and a better estimate, but not heavier", () => {
    // Before, best estimate: 100kg x 5 = 116,666 g. Now 95kg x 8 = 120,333 g; 12 reps beats 10.
    const workout = [s({ workoutId: W2, startedAt: DAY2, weightGrams: 95_000, done: 8 }), s({ workoutId: W2, startedAt: DAY2, position: 1, done: 12 })];
    expect(newRecordsIn(workout, before)).toEqual([
      { exercise: "squat", measuredIn: "reps", kind: "most_reps", position: 1 },
      { exercise: "squat", measuredIn: "reps", kind: "best_estimated_1rm", position: 0 },
    ]);
  });

  it("a longer hold, and a heavier hold, are told in time", () => {
    const told = newRecordsIn(
      [s({ workoutId: W2, startedAt: DAY2, exercise: "plank", measuredIn: "time", done: 61, weightGrams: 10_000 })],
      [s({ exercise: "plank", measuredIn: "time", done: 60, weightGrams: 5_000 })],
    );
    expect(told).toEqual([
      { exercise: "plank", measuredIn: "time", kind: "longest_hold", position: 0 },
      { exercise: "plank", measuredIn: "time", kind: "heaviest", position: 0 },
    ]);
  });

  it("several exercises: in the order the workout first did each", () => {
    const told = newRecordsIn(
      [
        s({ workoutId: W2, startedAt: DAY2, exercise: "plank", measuredIn: "time", position: 1, done: 61 }),
        s({ workoutId: W2, startedAt: DAY2, exercise: "squat", position: 0, done: 20 }),
      ],
      [s({ exercise: "plank", measuredIn: "time", done: 60 }), s({ exercise: "squat", done: 10 })],
    );
    expect(told.map((r) => r.exercise)).toEqual(["squat", "plank"]);
  });
});

describe("the records of one exercise", () => {
  it("none at all for no sets, or only sets of nothing done", () => {
    const none = { reps: { heaviest: null, mostReps: null, bestEstimated1rm: null, mostLifted: null }, time: { longestHold: null, heaviest: null } };
    expect(exerciseRecords([])).toEqual(none);
    expect(exerciseRecords([s({ done: 0, weightGrams: 50_000 }), s({ measuredIn: "time", done: 0 })])).toEqual(none);
  });

  it("a tie keeps the first time it was reached, whatever order the sets arrive in", () => {
    const later = s({ workoutId: W3, startedAt: DAY3, weightGrams: 100_000, done: 5 });
    const first = s({ workoutId: W2, startedAt: DAY2, weightGrams: 100_000, done: 5 });
    expect(exerciseRecords([later, first]).reps.heaviest?.workoutId).toBe(W2);
    // The same instant: the smaller workout id, then the earlier place.
    const sameA = s({ workoutId: W1, startedAt: DAY2, position: 3, weightGrams: 100_000 });
    const sameB = s({ workoutId: W2, startedAt: DAY2, position: 0, weightGrams: 100_000 });
    expect(exerciseRecords([sameB, sameA]).reps.heaviest?.workoutId).toBe(W1);
    expect(exerciseRecords([s({ position: 2, weightGrams: 1 }), s({ position: 1, weightGrams: 1 })]).reps.heaviest?.position).toBe(1);
  });

  it("a set with no weight counts for most reps only", () => {
    const r = exerciseRecords([s({ done: 30 })]);
    expect(r.reps.mostReps?.done).toBe(30);
    expect([r.reps.heaviest, r.reps.bestEstimated1rm, r.reps.mostLifted]).toEqual([null, null, null]);
  });

  it("best estimated one-rep max beats a heavier single, and leaves out sets past 10 reps", () => {
    const r = exerciseRecords([
      s({ weightGrams: 100_000, done: 1 }), // 100,000
      s({ position: 1, weightGrams: 90_000, done: 5 }), // 105,000
      s({ position: 2, weightGrams: 90_000, done: 15 }), // not worked out
    ]);
    expect(r.reps.bestEstimated1rm).toMatchObject({ position: 1, estimateGrams: 105_000 });
    expect(r.reps.heaviest?.position).toBe(0);
    expect(r.reps.mostReps?.position).toBe(2);
  });

  it("most lifted adds up one workout's sets and keeps the biggest workout", () => {
    const r = exerciseRecords([
      s({ weightGrams: 100_000, done: 5 }),
      s({ position: 1, weightGrams: 100_000, done: 5 }), // W1: 1,000,000 g
      s({ workoutId: W2, startedAt: DAY2, weightGrams: 150_000, done: 6 }), // W2: 900,000 g
      s({ workoutId: W2, startedAt: DAY2, position: 1, done: 50 }), // no weight: adds nothing
    ]);
    expect(r.reps.mostLifted).toEqual({ workoutId: W1, startedAt: DAY1, grams: 1_000_000 });
  });

  it("sets in time are kept apart from sets in reps", () => {
    const r = exerciseRecords([s({ measuredIn: "time", done: 45, weightGrams: 20_000 }), s({ position: 1, done: 12, weightGrams: 10_000 })]);
    expect(r.time.longestHold?.done).toBe(45);
    expect(r.time.heaviest?.weightGrams).toBe(20_000);
    expect(r.reps.mostReps?.done).toBe(12);
    expect(r.reps.heaviest?.weightGrams).toBe(10_000);
  });
});

describe("the estimate and the unit", () => {
  it.each([
    [null, 5, null],
    [100_000, 0, null],
    [100_000, 1, 100_000],
    [100_000, 10, 133_333],
    [100_000, 11, null],
    [1, 7, 1],
  ])("weight %s for %s reps is %s grams", (w, reps, want) => {
    expect(estimatedOneRepMaxGrams(w, reps)).toBe(want);
  });

  it.each([
    ["reps", 12, null, { measuredIn: "reps", done: 12 }],
    ["time", 0, 30_000, { measuredIn: "time", done: 30 }],
    [null, 0, 30_999, { measuredIn: "time", done: 30 }], // an old hold, rounded down
    [null, 8, null, { measuredIn: "reps", done: 8 }], // an old set of reps
    ["minutes", 8, null, { measuredIn: "reps", done: 8 }], // a word it does not know
  ] as const)("kept as %s, %s reps, %s ms", (unit, reps, holdMs, want) => {
    expect(unitAndDone(unit, reps, holdMs)).toEqual(want);
  });
});

describe("the first of each set done the same way gives the same records as every set", () => {
  // A fixed, made-up history: 300 sets over 40 workouts, with repeats, ties and both units.
  let seed = 7;
  const next = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  const all: SetFact[] = Array.from({ length: 300 }, (_, i) => {
    const w = i % 40;
    const time = next(4) === 0;
    return s({
      workoutId: `00000000-0000-4000-8000-${String(w).padStart(12, "0")}`,
      startedAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(w / 2))).toISOString(),
      position: Math.floor(i / 40),
      measuredIn: time ? "time" : "reps",
      done: time ? 20 + next(5) * 10 : next(13),
      weightGrams: next(3) === 0 ? null : 20_000 + next(4) * 5_000,
    });
  });
  // What the database's DISTINCT ON keeps: the earliest set of each way it was done.
  const firstOfEach = (sets: readonly SetFact[]) => {
    const seen = new Map<string, SetFact>();
    const ordered = [...sets].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || (a.workoutId < b.workoutId ? -1 : a.workoutId > b.workoutId ? 1 : 0) || a.position - b.position);
    for (const x of ordered) {
      const key = `${x.exercise}|${x.measuredIn}|${String(x.done)}|${String(x.weightGrams)}`;
      if (!seen.has(key)) seen.set(key, x);
    }
    return [...seen.values()];
  };

  it("the records", () => {
    const few = firstOfEach(all);
    expect(few.length).toBeLessThan(all.length / 3);
    expect(exerciseRecords(few, liftedOf(all))).toEqual(exerciseRecords(all));
  });

  it("the new records of the last workout", () => {
    // A later workout that beats one record and only ties two: the past's heaviest weight and longest
    // hold again, and one rep more than its most.
    const before = all;
    const past = exerciseRecords(before);
    const [heaviest, mostReps, longest] = [past.reps.heaviest?.weightGrams, past.reps.mostReps?.done, past.time.longestHold?.done];
    if (heaviest === undefined || heaviest === null || mostReps === undefined || longest === undefined) throw new Error("the made-up history has no records");
    const later = { workoutId: W3.replace("3", "9"), startedAt: "2026-03-01T08:00:00.000Z" };
    const last = [
      s({ ...later, position: 0, done: 1, weightGrams: heaviest }),
      s({ ...later, position: 1, done: mostReps + 1, weightGrams: null }),
      s({ ...later, position: 2, measuredIn: "time", done: longest, weightGrams: null }),
    ];
    const told = newRecordsIn(last, before);
    expect(told.map((r) => `${r.measuredIn} ${r.kind}`)).toEqual(["reps most_reps"]);
    expect(newRecordsIn(last, firstOfEach(before), liftedOf(before))).toEqual(told);
  });
});
